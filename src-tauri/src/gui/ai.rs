use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::time::Duration;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatRequest {
    pub endpoint: String,
    pub model: String,
    #[serde(default)]
    pub api_key: String,
    pub messages: Vec<AiChatMessage>,
    #[serde(default = "default_temperature")]
    pub temperature: f32,
}

fn default_temperature() -> f32 {
    0.15
}

fn completion_url(endpoint: &str) -> Result<reqwest::Url, String> {
    let trimmed = endpoint.trim().trim_end_matches('/');
    let candidate = if trimmed.ends_with("/chat/completions") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/chat/completions")
    };
    let url = reqwest::Url::parse(&candidate).map_err(|error| format!("Некорректный AI endpoint: {error}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("AI endpoint должен использовать http:// или https://".to_string());
    }

    if url.scheme() == "http" {
        let host = url.host_str().unwrap_or_default();
        let local = host.eq_ignore_ascii_case("localhost")
            || host == "127.0.0.1"
            || host == "::1"
            || host.ends_with(".localhost");
        if !local {
            return Err("Удалённый AI endpoint без TLS запрещён. Используйте https://; http:// разрешён только для localhost.".to_string());
        }
    }

    Ok(url)
}

fn extract_content(value: &Value) -> Result<String, String> {
    value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "AI provider вернул ответ без choices[0].message.content".to_string())
}

/// Provider-neutral OpenAI-compatible proxy.
///
/// API key intentionally lives only in the request and is never persisted or logged.
/// Remote plaintext HTTP is rejected; localhost HTTP remains available for Ollama/
/// LM Studio/other local OpenAI-compatible providers.
#[tauri::command]
pub async fn ai_chat_completion(request: AiChatRequest) -> Result<Value, String> {
    if request.model.trim().is_empty() {
        return Err("AI model не указан".to_string());
    }
    if request.messages.is_empty() {
        return Err("AI messages пусты".to_string());
    }
    if request.messages.len() > 32 {
        return Err("Слишком много AI messages в одном запросе".to_string());
    }
    if request.messages.iter().any(|message| message.content.len() > 64_000) {
        return Err("AI message превышает безопасный лимит размера".to_string());
    }

    let url = completion_url(&request.endpoint)?;
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|error| format!("Не удалось создать AI HTTP client: {error}"))?;

    let body = json!({
        "model": request.model.trim(),
        "messages": request.messages,
        "temperature": request.temperature.clamp(0.0, 2.0),
    });

    let mut builder = client
        .post(url)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .header(reqwest::header::ACCEPT, "application/json")
        .json(&body);
    if !request.api_key.trim().is_empty() {
        builder = builder.bearer_auth(request.api_key.trim());
    }

    let response = builder
        .send()
        .await
        .map_err(|error| format!("AI provider недоступен: {error}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("Не удалось прочитать AI response: {error}"))?;

    if !status.is_success() {
        let safe_excerpt: String = text.chars().take(1200).collect();
        return Err(format!("AI provider HTTP {}: {}", status.as_u16(), safe_excerpt));
    }

    let value: Value = serde_json::from_str(&text)
        .map_err(|error| format!("AI provider вернул не JSON: {error}"))?;
    let content = extract_content(&value)?;
    Ok(json!({ "content": content }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_local_plain_http() {
        let url = completion_url("http://127.0.0.1:11434/v1").unwrap();
        assert_eq!(url.as_str(), "http://127.0.0.1:11434/v1/chat/completions");
    }

    #[test]
    fn rejects_remote_plain_http() {
        assert!(completion_url("http://example.com/v1").is_err());
    }

    #[test]
    fn accepts_https_and_exact_completion_url() {
        let url = completion_url("https://api.example.com/v1/chat/completions").unwrap();
        assert_eq!(url.as_str(), "https://api.example.com/v1/chat/completions");
    }
}
