from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding='utf-8')


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding='utf-8')

# ---------------------------------------------------------------------------
# Pure, bounded text-expansion state + lazy template renderer.
# ---------------------------------------------------------------------------
write('src-tauri/src/daemon/text_expansion.rs', r'''use std::time::{Duration, Instant};

use crate::schemas::engine::EngineAction;
use crate::schemas::frontend::{TextDateFormat, TextTimeFormat};

pub const TEXT_BUFFER_MAX_CHARS: usize = 256;
pub const TEXT_BUFFER_TIMEOUT: Duration = Duration::from_secs(5);
pub const TEXT_UNDO_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone)]
pub struct TextUndoRecord {
    pub original_input: String,
    pub inserted_text: String,
    pub chars_removed: usize,
    pub timestamp: Instant,
    pub window_id: isize,
}

#[derive(Debug)]
pub struct TextInputState {
    pub buffer: String,
    pub last_input: Option<Instant>,
    pub window_id: isize,
    pub undo: Option<TextUndoRecord>,
}

impl Default for TextInputState {
    fn default() -> Self {
        Self { buffer: String::new(), last_input: None, window_id: 0, undo: None }
    }
}

impl TextInputState {
    pub fn prepare(&mut self, now: Instant, window_id: isize) {
        if self.window_id != window_id {
            self.window_id = window_id;
            self.clear_all();
            return;
        }
        if self.last_input.is_some_and(|last| now.duration_since(last) > TEXT_BUFFER_TIMEOUT) {
            self.buffer.clear();
            self.last_input = None;
        }
        if self.undo.as_ref().is_some_and(|undo| now.duration_since(undo.timestamp) > TEXT_UNDO_TIMEOUT) {
            self.undo = None;
        }
    }

    pub fn clear_buffer(&mut self) {
        self.buffer.clear();
        self.last_input = None;
    }

    pub fn clear_all(&mut self) {
        self.clear_buffer();
        self.undo = None;
    }

    pub fn note_printable(&mut self, text: String, now: Instant) {
        self.buffer = trim_to_last_chars(text, TEXT_BUFFER_MAX_CHARS);
        self.last_input = Some(now);
    }

    pub fn pop_backspace(&mut self, now: Instant) {
        self.buffer.pop();
        self.last_input = Some(now);
        self.undo = None;
    }

    pub fn set_undo(&mut self, record: TextUndoRecord) {
        self.undo = Some(record);
    }

    pub fn take_undo(&mut self, now: Instant, window_id: isize) -> Option<TextUndoRecord> {
        self.prepare(now, window_id);
        let valid = self.undo.as_ref().is_some_and(|undo| {
            undo.window_id == window_id && now.duration_since(undo.timestamp) <= TEXT_UNDO_TIMEOUT
        });
        if valid { self.undo.take() } else { self.undo = None; None }
    }
}

pub fn trim_to_last_chars(value: String, max_chars: usize) -> String {
    let count = value.chars().count();
    if count <= max_chars { return value; }
    let skip = count - max_chars;
    let byte = value.char_indices().nth(skip).map(|(idx, _)| idx).unwrap_or(value.len());
    value[byte..].to_string()
}

pub fn suffix_matches(buffer: &str, sequence: &str, case_sensitive: bool) -> bool {
    if sequence.is_empty() { return false; }
    if case_sensitive {
        buffer.ends_with(sequence)
    } else {
        buffer.to_lowercase().ends_with(&sequence.to_lowercase())
    }
}

pub fn suffix_chars(value: &str, count: usize) -> String {
    let total = value.chars().count();
    value.chars().skip(total.saturating_sub(count)).collect()
}

/// Delimiter config is readable in JSON/UI: literal chars plus `\\t` and `\\n`.
pub fn delimiter_contains(config: &str, value: char) -> bool {
    config.contains(value)
        || (value == '\t' && config.contains("\\t"))
        || (value == '\n' && config.contains("\\n"))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DateTimeParts {
    pub year: u16,
    pub month: u16,
    pub day: u16,
    pub hour: u16,
    pub minute: u16,
    pub second: u16,
}

fn format_date(parts: DateTimeParts, format: TextDateFormat) -> String {
    match format {
        TextDateFormat::Dmy => format!("{:02}.{:02}.{:04}", parts.day, parts.month, parts.year),
        TextDateFormat::Ymd => format!("{:04}-{:02}-{:02}", parts.year, parts.month, parts.day),
        TextDateFormat::Mdy => format!("{:02}/{:02}/{:04}", parts.month, parts.day, parts.year),
    }
}

fn format_time(parts: DateTimeParts, format: TextTimeFormat) -> String {
    match format {
        TextTimeFormat::Hm24 => format!("{:02}:{:02}", parts.hour, parts.minute),
        TextTimeFormat::Hms24 => format!("{:02}:{:02}:{:02}", parts.hour, parts.minute, parts.second),
        TextTimeFormat::Hm12 => {
            let suffix = if parts.hour < 12 { "AM" } else { "PM" };
            let hour = match parts.hour % 12 { 0 => 12, value => value };
            format!("{}:{:02} {}", hour, parts.minute, suffix)
        }
    }
}

pub fn render_template_with(
    template: &str,
    date_format: TextDateFormat,
    time_format: TextTimeFormat,
    parts: DateTimeParts,
    clipboard: Option<&str>,
) -> String {
    let mut rendered = template.to_string();
    if rendered.contains("{{date}}") {
        rendered = rendered.replace("{{date}}", &format_date(parts, date_format));
    }
    if rendered.contains("{{time}}") {
        rendered = rendered.replace("{{time}}", &format_time(parts, time_format));
    }
    if rendered.contains("{{clipboard}}") {
        rendered = rendered.replace("{{clipboard}}", clipboard.unwrap_or(""));
    }
    rendered
}

#[cfg(target_os = "windows")]
fn local_parts() -> DateTimeParts {
    use windows::Win32::System::SystemInformation::GetLocalTime;
    let value = unsafe { GetLocalTime() };
    DateTimeParts {
        year: value.wYear, month: value.wMonth, day: value.wDay,
        hour: value.wHour, minute: value.wMinute, second: value.wSecond,
    }
}

#[cfg(not(target_os = "windows"))]
fn local_parts() -> DateTimeParts {
    DateTimeParts { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0 }
}

#[cfg(target_os = "windows")]
fn read_clipboard_text() -> Option<String> {
    use windows::Win32::Foundation::HGLOBAL;
    use windows::Win32::System::DataExchange::{CloseClipboard, GetClipboardData, OpenClipboard};
    use windows::Win32::System::Memory::{GlobalLock, GlobalUnlock};
    use windows::Win32::System::Ole::CF_UNICODETEXT;

    struct ClipboardGuard;
    impl Drop for ClipboardGuard {
        fn drop(&mut self) { unsafe { let _ = CloseClipboard(); } }
    }

    unsafe {
        OpenClipboard(None).ok()?;
        let _guard = ClipboardGuard;
        let handle = GetClipboardData(CF_UNICODETEXT.0 as u32).ok()?;
        let global = HGLOBAL(handle.0);
        let ptr = GlobalLock(global) as *const u16;
        if ptr.is_null() { return None; }
        let mut len = 0usize;
        while *ptr.add(len) != 0 && len < 1_048_576 { len += 1; }
        let text = String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len));
        let _ = GlobalUnlock(global);
        Some(text)
    }
}

#[cfg(not(target_os = "windows"))]
fn read_clipboard_text() -> Option<String> { None }

/// Dynamic sources are lazy. In particular clipboard APIs are never touched
/// unless this exact fired template contains `{{clipboard}}`.
pub fn render_template(template: &str, date_format: TextDateFormat, time_format: TextTimeFormat) -> String {
    let needs_clock = template.contains("{{date}}") || template.contains("{{time}}");
    let parts = if needs_clock { local_parts() } else {
        DateTimeParts { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0 }
    };
    let clipboard = if template.contains("{{clipboard}}") { read_clipboard_text() } else { None };
    render_template_with(template, date_format, time_format, parts, clipboard.as_deref())
}

/// Render every TypeText action exactly once for a fired expansion. The returned
/// actions use TypeTextLiteral so clipboard/date contents cannot be interpreted
/// a second time. Undo is offered only if the complete expansion is text-only.
pub fn materialize_text_actions(actions: &[EngineAction]) -> (Vec<EngineAction>, Option<String>) {
    let mut out = Vec::with_capacity(actions.len());
    let mut concatenated = String::new();
    let mut text_only = true;
    for action in actions {
        match action {
            EngineAction::TypeText { text, date_format, time_format } => {
                let rendered = render_template(text, *date_format, *time_format);
                concatenated.push_str(&rendered);
                out.push(EngineAction::TypeTextLiteral { text: rendered });
            }
            EngineAction::TypeTextLiteral { text } => {
                concatenated.push_str(text);
                out.push(action.clone());
            }
            _ => {
                text_only = false;
                out.push(action.clone());
            }
        }
    }
    (out, text_only.then_some(concatenated))
}

#[cfg(test)]
mod tests {
    use super::*;

    const PARTS: DateTimeParts = DateTimeParts {
        year: 2026, month: 8, day: 17, hour: 16, minute: 5, second: 9,
    };

    #[test]
    fn suffix_matching_is_unicode_and_case_aware() {
        assert!(suffix_matches("hello;Mail", ";Mail", true));
        assert!(!suffix_matches("hello;mail", ";Mail", true));
        assert!(suffix_matches("hello;mail", ";Mail", false));
        assert!(suffix_matches("тест;ПРИВЕТ", ";привет", false));
    }

    #[test]
    fn delimiter_config_supports_literal_and_escaped_whitespace() {
        assert!(delimiter_contains(" \\t\\n.,", ' '));
        assert!(delimiter_contains(" \\t\\n.,", '\t'));
        assert!(delimiter_contains(" \\t\\n.,", '\n'));
        assert!(delimiter_contains(" \\t\\n.,", '.'));
        assert!(!delimiter_contains(" \\t\\n.,", 'x'));
    }

    #[test]
    fn buffer_is_bounded_by_unicode_characters() {
        let value = format!("{}END", "я".repeat(TEXT_BUFFER_MAX_CHARS));
        let trimmed = trim_to_last_chars(value, TEXT_BUFFER_MAX_CHARS);
        assert_eq!(trimmed.chars().count(), TEXT_BUFFER_MAX_CHARS);
        assert!(trimmed.ends_with("END"));
    }

    #[test]
    fn focus_timeout_backspace_and_undo_lifecycle_are_memory_only() {
        let t0 = Instant::now();
        let mut state = TextInputState::default();
        state.prepare(t0, 11);
        state.note_printable("abc".into(), t0);
        state.pop_backspace(t0 + Duration::from_millis(1));
        assert_eq!(state.buffer, "ab");
        state.note_printable("abc".into(), t0 + Duration::from_millis(2));
        state.set_undo(TextUndoRecord {
            original_input: "abc".into(), inserted_text: "XYZ".into(), chars_removed: 2,
            timestamp: t0 + Duration::from_millis(2), window_id: 11,
        });
        assert!(state.take_undo(t0 + Duration::from_secs(1), 11).is_some());
        state.note_printable("again".into(), t0 + Duration::from_secs(1));
        state.prepare(t0 + TEXT_BUFFER_TIMEOUT + Duration::from_secs(2), 11);
        assert!(state.buffer.is_empty());
        state.note_printable("window".into(), t0 + Duration::from_secs(20));
        state.prepare(t0 + Duration::from_secs(20), 12);
        assert!(state.buffer.is_empty());
        assert!(state.undo.is_none());
    }

    #[test]
    fn date_time_and_clipboard_tokens_are_deterministic() {
        let tpl = "{{date}} {{time}} :: {{clipboard}}";
        assert_eq!(
            render_template_with(tpl, TextDateFormat::Dmy, TextTimeFormat::Hm24, PARTS, Some("clip")),
            "17.08.2026 16:05 :: clip"
        );
        assert_eq!(
            render_template_with("{{date}}", TextDateFormat::Ymd, TextTimeFormat::Hm24, PARTS, None),
            "2026-08-17"
        );
        assert_eq!(
            render_template_with("{{time}}", TextDateFormat::Dmy, TextTimeFormat::Hms24, PARTS, None),
            "16:05:09"
        );
        assert_eq!(
            render_template_with("{{time}}", TextDateFormat::Dmy, TextTimeFormat::Hm12, PARTS, None),
            "4:05 PM"
        );
    }
}
''')

# ---------------------------------------------------------------------------
# Internal literal action prevents a clipboard result containing token-looking
# text from being rendered twice.
# ---------------------------------------------------------------------------
p = 'src-tauri/src/schemas/engine.rs'
s = read(p)
s = s.replace(
    '''    TypeText {
        text: String,
        date_format: TextDateFormat,
        time_format: TextTimeFormat,
    },''',
    '''    TypeText {
        text: String,
        date_format: TextDateFormat,
        time_format: TextTimeFormat,
    },
    TypeTextLiteral { text: String },''',
    1,
)
write(p, s)

# ---------------------------------------------------------------------------
# Engine integration: focus/timeout reset, instant/delimiter matching, exact
# deletion counts, lazy materialization, and one-shot Ctrl+Z.
# ---------------------------------------------------------------------------
p = 'src-tauri/src/daemon/engine.rs'
s = read(p)
s = s.replace(
    'use crate::schemas::frontend::key_modifiers;',
    'use crate::schemas::frontend::{key_modifiers, TextExpansionMode};\nuse crate::daemon::text_expansion::{delimiter_contains, materialize_text_actions, suffix_chars, suffix_matches, TextUndoRecord};',
    1,
)

old_action = '''            EngineAction::TypeText { text } => {
                if is_down {
                    if trigger_modifiers != 0 {
                        send_isolated_immediate(
                            simulator,
                            [SimulatorCommand::TypeString(text.clone())],
                        );
                    } else {
                        let _ = simulator.send(SimulatorCommand::TypeString(text.clone()));
                    }
                }
            }'''
new_action = '''            EngineAction::TypeText { text, date_format, time_format } => {
                if is_down {
                    let rendered = crate::daemon::text_expansion::render_template(text, *date_format, *time_format);
                    if trigger_modifiers != 0 {
                        send_isolated_immediate(simulator, [SimulatorCommand::TypeString(rendered)]);
                    } else {
                        let _ = simulator.send(SimulatorCommand::TypeString(rendered));
                    }
                }
            }
            EngineAction::TypeTextLiteral { text } => {
                if is_down {
                    if trigger_modifiers != 0 {
                        send_isolated_immediate(simulator, [SimulatorCommand::TypeString(text.clone())]);
                    } else {
                        let _ = simulator.send(SimulatorCommand::TypeString(text.clone()));
                    }
                }
            }'''
if old_action not in s:
    raise SystemExit('engine TypeText action anchor missing')
s = s.replace(old_action, new_action, 1)

start = s.index('    // Text expansion matching\n', s.index('pub fn process_keyboard_event'))
end = s.index('    // Check Tap-Hold resolution FIRST\n', start)
new_block = r'''    // Text expansion matching. State is bounded and in-memory only.
    if is_key_down {
        let now = Instant::now();
        let window_id = try_read_ctx(&ctx_arc).map(|ctx| ctx.active_window_id).unwrap_or(0);
        let ctrl_mask = key_modifiers::CTRL | key_modifiers::LCTRL | key_modifiers::RCTRL;
        let alt_win_mask = key_modifiers::ALT | key_modifiers::LALT | key_modifiers::RALT
            | key_modifiers::WIN | key_modifiers::LWIN | key_modifiers::RWIN;
        let ctrl_active = event_modifiers & ctrl_mask != 0;

        // Ctrl+Z consumes only our immediately preceding text-only expansion.
        if vk_code == 0x5A && ctrl_active {
            let undo = s.text_input.lock().ok().and_then(|mut input| input.take_undo(now, window_id));
            if let Some(undo) = undo {
                for _ in 0..undo.inserted_text.chars().count() {
                    let _ = simulator.send(SimulatorCommand::PressKey(0x08));
                    let _ = simulator.send(SimulatorCommand::ReleaseKey(0x08));
                }
                let _ = simulator.send(SimulatorCommand::TypeString(undo.original_input));
                if let Ok(mut input) = s.text_input.lock() { input.clear_buffer(); }
                return EventAction::Block;
            }
        }

        let hard_modifier_vk = matches!(vk_code, 0x11 | 0x12 | 0x5B | 0x5C | 0xA2 | 0xA3 | 0xA4 | 0xA5);
        let modified_non_modifier = !is_modifier_vk(vk_code) && (event_modifiers & (ctrl_mask | alt_win_mask) != 0);
        let navigation = matches!(vk_code, 0x21..=0x28 | 0x2D);

        if hard_modifier_vk {
            // Preserve undo while Ctrl is being pressed so the following Z can consume it.
            if let Ok(mut input) = s.text_input.lock() {
                input.prepare(now, window_id);
                input.clear_buffer();
            }
        } else if modified_non_modifier {
            if let Ok(mut input) = s.text_input.lock() {
                input.prepare(now, window_id);
                input.clear_all();
            }
        } else if vk_code == 0x08 {
            if let Ok(mut input) = s.text_input.lock() {
                input.prepare(now, window_id);
                input.pop_backspace(now);
            }
        } else if vk_code == 0x2E || navigation {
            if let Ok(mut input) = s.text_input.lock() {
                input.prepare(now, window_id);
                input.clear_all();
            }
        } else if is_modifier_vk(vk_code) {
            // Shift is allowed to participate in mixed-case abbreviations.
            if let Ok(mut input) = s.text_input.lock() { input.prepare(now, window_id); }
        } else if let Some(c) = vk_to_char(vk_code, scan_code) {
            let (before, prospective) = match s.text_input.lock() {
                Ok(mut input) => {
                    input.prepare(now, window_id);
                    // Any ordinary edit invalidates the previous undo. A newly fired
                    // expansion below will install its own record.
                    input.undo = None;
                    let before = input.buffer.clone();
                    let mut prospective = before.clone();
                    prospective.push(c);
                    (before, prospective)
                }
                Err(_) => (String::new(), c.to_string()),
            };

            let mut matched = None;
            if let Some(ctx) = try_read_ctx(&ctx_arc) {
                for candidate in &engine_schema.text_expansion_rules {
                    let source = match candidate.mode {
                        TextExpansionMode::Instant => prospective.as_str(),
                        TextExpansionMode::Delimiter if delimiter_contains(&candidate.delimiters, c) => before.as_str(),
                        TextExpansionMode::Delimiter => continue,
                    };
                    if suffix_matches(source, &candidate.sequence, candidate.case_sensitive)
                        && check_conditions(&candidate.rule.conditions, &ctx)
                    {
                        matched = Some(candidate.clone());
                        break;
                    }
                }
            }

            if let Some(candidate) = matched {
                let seq_chars = candidate.sequence.chars().count();
                let (source, backspaces, delimiter) = match candidate.mode {
                    TextExpansionMode::Instant => (&prospective, seq_chars.saturating_sub(1), None),
                    TextExpansionMode::Delimiter => (&before, seq_chars, Some(c)),
                };
                let actual_sequence = suffix_chars(source, seq_chars);
                let mut original_input = actual_sequence;
                if let Some(delimiter) = delimiter { original_input.push(delimiter); }

                if let Ok(mut input) = s.text_input.lock() { input.clear_buffer(); }
                for _ in 0..backspaces {
                    let _ = simulator.send(SimulatorCommand::PressKey(0x08));
                    let _ = simulator.send(SimulatorCommand::ReleaseKey(0x08));
                }

                let (actions, rendered_text) = materialize_text_actions(&candidate.rule.actions);
                execute_actions(&actions, simulator, &ctx_arc, true, state, 0);
                execute_actions(&actions, simulator, &ctx_arc, false, state, 0);

                if let Some(delimiter) = delimiter {
                    let _ = simulator.send(SimulatorCommand::TypeString(delimiter.to_string()));
                }

                if let Some(mut inserted_text) = rendered_text {
                    if let Some(delimiter) = delimiter { inserted_text.push(delimiter); }
                    if let Ok(mut input) = s.text_input.lock() {
                        input.set_undo(TextUndoRecord {
                            original_input,
                            inserted_text,
                            chars_removed: backspaces,
                            timestamp: now,
                            window_id,
                        });
                    }
                }
                return EventAction::Block;
            }

            if let Ok(mut input) = s.text_input.lock() {
                input.note_printable(prospective, now);
            }
        } else if let Ok(mut input) = s.text_input.lock() {
            input.prepare(now, window_id);
            input.clear_all();
        }
    }

'''
s = s[:start] + new_block + s[end:]

# Mouse interaction invalidates typed buffer and undo.
s = s.replace(
    '''    if is_down {
        if let Ok(mut buf) = s.typed_buffer.lock() {
            buf.clear();
        }
    }''',
    '''    if is_down {
        if let Ok(mut input) = s.text_input.lock() {
            input.clear_all();
        }
    }''',
    1,
)

# Use the actual LL-hook scan code, preserving active Windows layout (incl. Cyrillic).
old_vk = '''#[cfg(target_os = "windows")]
fn is_shift_pressed() -> bool {
    unsafe {
        let state = windows::Win32::UI::Input::KeyboardAndMouse::GetKeyState(0x10);
        (state & 0x8000u16 as i16) != 0
    }
}

#[cfg(not(target_os = "windows"))]
fn is_shift_pressed() -> bool {
    false
}

#[cfg(target_os = "windows")]
fn vk_to_char(vk: u8, _shift: bool) -> Option<char> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetKeyboardLayout, GetKeyboardState, MapVirtualKeyW, ToUnicodeEx, MAPVK_VK_TO_VSC_EX,
    };

    unsafe {
        let mut key_state = [0u8; 256];
        if GetKeyboardState(&mut key_state).is_err() {
            return None;
        }

        let dwhkl = GetKeyboardLayout(0);
        let scan_code = MapVirtualKeyW(vk as u32, MAPVK_VK_TO_VSC_EX);

        let mut buf = [0u16; 4];
        let result = ToUnicodeEx(vk as u32, scan_code, &key_state, &mut buf, 0, Some(dwhkl));

        if result > 0 {
            if let Some(c) = char::from_u32(buf[0] as u32) {
                if !c.is_control() {
                    return Some(c);
                }
            }
        }
        None
    }
}

#[cfg(not(target_os = "windows"))]
fn vk_to_char(_vk: u8, _shift: bool) -> Option<char> {
    None
}
'''
new_vk = '''#[cfg(target_os = "windows")]
fn vk_to_char(vk: u8, hook_scan_code: u16) -> Option<char> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetKeyboardLayout, GetKeyboardState, MapVirtualKeyW, ToUnicodeEx, MAPVK_VK_TO_VSC_EX,
    };

    match vk {
        0x20 => return Some(' '),
        0x09 => return Some('\\t'),
        0x0D => return Some('\\n'),
        _ => {}
    }

    unsafe {
        let mut key_state = [0u8; 256];
        if GetKeyboardState(&mut key_state).is_err() { return None; }
        let layout = GetKeyboardLayout(0);
        let scan_code = if hook_scan_code == 0 {
            MapVirtualKeyW(vk as u32, MAPVK_VK_TO_VSC_EX)
        } else {
            hook_scan_code as u32
        };
        let mut buf = [0u16; 4];
        let result = ToUnicodeEx(vk as u32, scan_code, &key_state, &mut buf, 0, Some(layout));
        if result > 0 {
            char::from_u32(buf[0] as u32).filter(|c| !c.is_control())
        } else {
            None
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn vk_to_char(_vk: u8, _scan_code: u16) -> Option<char> { None }
'''
if old_vk not in s:
    raise SystemExit('vk_to_char anchor missing')
s = s.replace(old_vk, new_vk, 1)
# process_keyboard_event now consumes scan code.
s = s.replace('    _scan_code: u16,', '    scan_code: u16,', 1)
write(p, s)

print('v0.3.3 bounded runtime + undo staged')
