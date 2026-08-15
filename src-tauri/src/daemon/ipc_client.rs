/// IPC Named Pipe Client
///
/// Клиент для GUI-процесса. Подключается к Named Pipe daemon'а,
/// отправляет JSON-RPC 2.0 запросы и получает ответы.

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::windows::named_pipe::ClientOptions;
use tracing::debug;

use super::ipc_types::*;
use crate::shared::constants;

const IPC_RESPONSE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// Отправить JSON-RPC запрос в Daemon и получить ответ
///
/// Подключается к Named Pipe, отправляет запрос, читает ответ.
/// Протокол: Newline-delimited JSON.
pub async fn call(method: &str, params: Option<serde_json::Value>) -> Result<serde_json::Value, String> {
    let pipe_path = constants::IPC_PIPE_NAME;

    debug!("IPC Client → {} {:?}", method, params);

    let mut pipe = None;
    let mut last_err = None;

    // Retry connection to handle transient named pipe race conditions
    for _ in 0..10 {
        match ClientOptions::new().open(pipe_path) {
            Ok(p) => {
                pipe = Some(p);
                break;
            }
            Err(e) => {
                last_err = Some(e);
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        }
    }

    let pipe = match pipe {
        Some(p) => p,
        None => {
            let err_msg = last_err.map(|e| e.to_string()).unwrap_or_else(|| "Unknown error".to_string());
            return Err(format!("Failed to connect to daemon pipe: {}. Is daemon running?", err_msg));
        }
    };

    // Формируем JSON-RPC запрос
    let request = JsonRpcRequest {
        jsonrpc: "2.0".to_string(),
        method: method.to_string(),
        params,
        id: Some(serde_json::json!(1)),
    };

    let mut request_bytes = serde_json::to_string(&request)
        .map_err(|e| format!("Ошибка сериализации запроса: {}", e))?;
    request_bytes.push('\n');

    // Отправляем запрос и явно flush'им pipe перед ожиданием ответа.
    let (reader, mut writer) = tokio::io::split(pipe);
    writer.write_all(request_bytes.as_bytes()).await
        .map_err(|e| format!("Ошибка отправки запроса: {}", e))?;
    writer.flush().await
        .map_err(|e| format!("Ошибка flush IPC-запроса: {}", e))?;

    // Читаем ответ (одна строка). Если daemon завис после принятия соединения,
    // не оставляем вызывающую UI-операцию висеть бесконечно.
    let mut lines = BufReader::new(reader).lines();
    let response_line = tokio::time::timeout(IPC_RESPONSE_TIMEOUT, lines.next_line())
        .await
        .map_err(|_| format!("IPC timeout: daemon не ответил на '{}' за {} сек.", method, IPC_RESPONSE_TIMEOUT.as_secs()))?
        .map_err(|e| format!("Ошибка чтения ответа: {}", e))?
        .ok_or("Пустой ответ от daemon")?;

    // Парсим JSON-RPC ответ
    let response: JsonRpcResponse = serde_json::from_str(&response_line)
        .map_err(|e| format!("Ошибка парсинга ответа: {}: '{}'", e, response_line))?;

    debug!("IPC Client ← {:?}", response);

    // Проверяем на ошибку
    if let Some(err) = response.error {
        return Err(format!("IPC error [{}]: {}", err.code, err.message));
    }

    // Возвращаем result
    response.result.ok_or_else(|| "IPC: пустой result".to_string())
}
