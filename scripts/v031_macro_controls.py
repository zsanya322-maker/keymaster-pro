from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]

def p(path): return ROOT / path
def read(path): return p(path).read_text(encoding='utf-8')
def write(path, text): p(path).write_text(text, encoding='utf-8')
def replace_once(path, old, new):
    text = read(path)
    if text.count(old) != 1:
        raise RuntimeError(f'{path}: expected one match for {old[:100]!r}, got {text.count(old)}')
    write(path, text.replace(old, new, 1))

def replace_between(path, start_marker, end_marker, replacement):
    text = read(path)
    start = text.index(start_marker)
    end = text.index(end_marker, start)
    write(path, text[:start] + replacement + text[end:])

def set_nested(obj, keys, value):
    cur = obj
    for key in keys[:-1]: cur = cur.setdefault(key, {})
    cur[keys[-1]] = value

# ---------- Macro model ----------
frontend = read('src-tauri/src/schemas/frontend.rs')
insert = r'''
fn default_macro_speed() -> f32 { 1.0 }
fn default_macro_repeat_count() -> u32 { 1 }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MacroPlayback {
    pub speed: f32,
    pub repeat_count: u32,
    pub repeat_while_held: bool,
}

impl Default for MacroPlayback {
    fn default() -> Self {
        Self { speed: default_macro_speed(), repeat_count: default_macro_repeat_count(), repeat_while_held: false }
    }
}

'''
marker = '#[derive(Debug, Clone, Serialize, Deserialize)]\n#[serde(tag = "type", rename_all = "camelCase")]\npub enum FrontendAction {'
if 'pub struct MacroPlayback' not in frontend:
    frontend = frontend.replace(marker, insert + marker, 1)
frontend = frontend.replace('    RunMacro { steps: Vec<MacroStep> },', '    RunMacro { steps: Vec<MacroStep>, #[serde(default)] playback: MacroPlayback },')
write('src-tauri/src/schemas/frontend.rs', frontend)

engine_schema = read('src-tauri/src/schemas/engine.rs')
if 'pub struct MacroPlaybackConfig' not in engine_schema:
    engine_schema = engine_schema.replace('#[derive(Debug, Clone)]\npub enum EngineAction {', '''#[derive(Debug, Clone)]
pub struct MacroPlaybackConfig {
    pub speed: f32,
    pub repeat_count: u32,
    pub repeat_while_held: bool,
}

#[derive(Debug, Clone)]
pub enum EngineAction {''', 1)
engine_schema = engine_schema.replace('    MacroCommands { commands: Vec<SimulatorCommand> },', '    MacroCommands { commands: Vec<SimulatorCommand>, playback: MacroPlaybackConfig, macro_key: u64 },')
write('src-tauri/src/schemas/engine.rs', engine_schema)

# ---------- Compiler ----------
compiler = read('src-tauri/src/daemon/compiler.rs')
compiler = compiler.replace('EngineSchema, SimulatorCommand,', 'EngineSchema, MacroPlaybackConfig, SimulatorCommand,')
compiler = compiler.replace('    FrontendAction, FrontendCondition, FrontendConfig, FrontendRule, FrontendTrigger,\n    MacroAction, MouseWheelDirection,', '    FrontendAction, FrontendCondition, FrontendConfig, FrontendRule, FrontendTrigger,\n    MacroAction, MacroPlayback, MacroStep, MouseWheelDirection,')
compiler = compiler.replace('rule.actions.iter().map(compile_action).collect()', 'rule.actions.iter().map(|action| compile_action(action, calculate_hash(&rule.id))).collect()')
compiler = compiler.replace('actions.iter().map(compile_action).collect()', 'actions.iter().map(|action| compile_action(action, calculate_hash(&rule.id))).collect()')
compiler = compiler.replace('fn compile_action(a: &FrontendAction) -> EngineAction {', 'fn compile_action(a: &FrontendAction, macro_key: u64) -> EngineAction {')
start = compiler.index('        FrontendAction::RunMacro {')
end = compiler.index('        FrontendAction::ToggleLayer', start)
runmacro = r'''        FrontendAction::RunMacro { steps, playback } => EngineAction::MacroCommands {
            commands: compile_macro_commands(steps),
            playback: compile_macro_playback(playback),
            macro_key,
        },
'''
compiler = compiler[:start] + runmacro + compiler[end:]
helper_marker = 'fn compile_action(a: &FrontendAction, macro_key: u64) -> EngineAction {'
helpers = r'''pub fn compile_macro_playback(playback: &MacroPlayback) -> MacroPlaybackConfig {
    MacroPlaybackConfig {
        speed: playback.speed.clamp(0.1, 10.0),
        repeat_count: playback.repeat_count.max(1).min(10_000),
        repeat_while_held: playback.repeat_while_held,
    }
}

pub fn compile_macro_commands(steps: &[MacroStep]) -> Vec<SimulatorCommand> {
    let mut commands = Vec::new();
    for step in steps {
        match step.action {
            MacroAction::KeyDown { code } => commands.push(SimulatorCommand::PressKey(code)),
            MacroAction::KeyUp { code } => commands.push(SimulatorCommand::ReleaseKey(code)),
            MacroAction::MouseDown { code } => commands.push(SimulatorCommand::MousePress(code)),
            MacroAction::MouseUp { code } => commands.push(SimulatorCommand::MouseRelease(code)),
            MacroAction::MouseMove { dx, dy } => commands.push(SimulatorCommand::MouseMove { dx, dy }),
            MacroAction::MouseScroll { delta } => commands.push(SimulatorCommand::MouseScroll { delta }),
            MacroAction::MouseToAbsolute { x, y } => commands.push(SimulatorCommand::MouseAbsolute { x, y }),
        }
        if step.delay_ms > 0 { commands.push(SimulatorCommand::Delay(step.delay_ms)); }
    }
    commands
}

'''
if 'pub fn compile_macro_commands' not in compiler:
    compiler = compiler.replace(helper_marker, helpers + helper_marker, 1)
write('src-tauri/src/daemon/compiler.rs', compiler)

# ---------- Job-based macro simulator ----------
simulator = r'''use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tracing::info;

pub mod system;

use crate::schemas::engine::{MacroPlaybackConfig, SimulatorCommand};

#[cfg(target_os = "windows")]
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, MOUSEINPUT,
    KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_HWHEEL,
    MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP,
    MOUSEEVENTF_MOVE, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_WHEEL,
    MOUSEEVENTF_XDOWN, MOUSEEVENTF_XUP,
};

#[derive(Debug, Clone)]
struct MacroJob {
    id: u64,
    macro_key: u64,
    generation: u64,
    commands: Vec<SimulatorCommand>,
    playback: MacroPlaybackConfig,
}

#[derive(Default)]
struct MacroRuntime {
    next_id: AtomicU64,
    generation: AtomicU64,
    active_id: AtomicU64,
    cancelled_ids: Mutex<HashSet<u64>>,
    cancelled_keys: Mutex<HashSet<u64>>,
}

#[derive(Clone)]
pub struct SimulatorSender {
    immediate_tx: Sender<SimulatorCommand>,
    macro_tx: Sender<MacroJob>,
    runtime: Arc<MacroRuntime>,
}

impl std::fmt::Debug for SimulatorSender {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SimulatorSender").finish_non_exhaustive()
    }
}

impl SimulatorSender {
    pub fn send(&self, command: SimulatorCommand) -> Result<(), String> {
        self.immediate_tx.send(command).map_err(|e| e.to_string())
    }

    pub fn send_macro(&self, commands: Vec<SimulatorCommand>, playback: MacroPlaybackConfig, macro_key: u64) -> Result<u64, String> {
        if let Ok(mut keys) = self.runtime.cancelled_keys.lock() { keys.remove(&macro_key); }
        let id = self.runtime.next_id.fetch_add(1, Ordering::Relaxed).wrapping_add(1);
        let job = MacroJob {
            id,
            macro_key,
            generation: self.runtime.generation.load(Ordering::Acquire),
            commands,
            playback,
        };
        self.macro_tx.send(job).map_err(|e| e.to_string())?;
        Ok(id)
    }

    pub fn cancel_macro_key(&self, macro_key: u64) {
        if let Ok(mut keys) = self.runtime.cancelled_keys.lock() { keys.insert(macro_key); }
    }

    pub fn cancel_current_macro(&self) {
        let id = self.runtime.active_id.load(Ordering::Acquire);
        if id != 0 {
            if let Ok(mut ids) = self.runtime.cancelled_ids.lock() { ids.insert(id); }
        }
    }

    pub fn cancel_all_macros(&self) {
        self.runtime.generation.fetch_add(1, Ordering::AcqRel);
        self.cancel_current_macro();
    }
}

type CommandExecutor = Arc<dyn Fn(SimulatorCommand) + Send + Sync + 'static>;

fn is_cancelled(runtime: &MacroRuntime, job: &MacroJob) -> bool {
    if runtime.generation.load(Ordering::Acquire) != job.generation { return true; }
    if runtime.cancelled_ids.lock().map(|ids| ids.contains(&job.id)).unwrap_or(true) { return true; }
    runtime.cancelled_keys.lock().map(|keys| keys.contains(&job.macro_key)).unwrap_or(true)
}

fn scaled_delay_ms(ms: u32, speed: f32) -> u32 {
    if ms == 0 { return 0; }
    ((ms as f32 / speed.clamp(0.1, 10.0)).round() as u32).max(1)
}

fn release_held(executor: &CommandExecutor, keys: &mut HashSet<u8>, buttons: &mut HashSet<u8>) {
    for code in keys.drain() { executor(SimulatorCommand::ReleaseKey(code)); }
    for code in buttons.drain() { executor(SimulatorCommand::MouseRelease(code)); }
}

fn execute_job(job: &MacroJob, runtime: &MacroRuntime, executor: &CommandExecutor) {
    let mut held_keys = HashSet::new();
    let mut held_buttons = HashSet::new();
    let mut completed = 0u32;

    'repeats: loop {
        if is_cancelled(runtime, job) { break; }
        for command in &job.commands {
            if is_cancelled(runtime, job) { break 'repeats; }
            match command {
                SimulatorCommand::Delay(ms) => {
                    let mut remaining = scaled_delay_ms(*ms, job.playback.speed);
                    while remaining > 0 {
                        if is_cancelled(runtime, job) { break 'repeats; }
                        let slice = remaining.min(10);
                        thread::sleep(Duration::from_millis(u64::from(slice)));
                        remaining -= slice;
                    }
                }
                SimulatorCommand::PressKey(code) => { held_keys.insert(*code); executor(command.clone()); }
                SimulatorCommand::ReleaseKey(code) => { held_keys.remove(code); executor(command.clone()); }
                SimulatorCommand::MousePress(code) => { held_buttons.insert(*code); executor(command.clone()); }
                SimulatorCommand::MouseRelease(code) => { held_buttons.remove(code); executor(command.clone()); }
                _ => executor(command.clone()),
            }
        }
        completed = completed.saturating_add(1);
        if !job.playback.repeat_while_held && completed >= job.playback.repeat_count.max(1) { break; }
    }

    // Never leak a synthetic held input, on cancellation or malformed macro end.
    release_held(executor, &mut held_keys, &mut held_buttons);
    if let Ok(mut ids) = runtime.cancelled_ids.lock() { ids.remove(&job.id); }
}

fn spawn_simulator_with_executor(executor: CommandExecutor) -> SimulatorSender {
    let (immediate_tx, immediate_rx): (Sender<SimulatorCommand>, Receiver<SimulatorCommand>) = mpsc::channel();
    let (macro_tx, macro_rx): (Sender<MacroJob>, Receiver<MacroJob>) = mpsc::channel();
    let runtime = Arc::new(MacroRuntime::default());

    let immediate_executor = Arc::clone(&executor);
    thread::Builder::new().name("km-simulator".into()).spawn(move || {
        info!("Immediate simulator thread started.");
        while let Ok(command) = immediate_rx.recv() { immediate_executor(command); }
    }).expect("Failed to spawn simulator thread");

    let worker_runtime = Arc::clone(&runtime);
    thread::Builder::new().name("km-macro-player".into()).spawn(move || {
        info!("Macro player thread started.");
        while let Ok(job) = macro_rx.recv() {
            worker_runtime.active_id.store(job.id, Ordering::Release);
            execute_job(&job, &worker_runtime, &executor);
            worker_runtime.active_id.store(0, Ordering::Release);
        }
    }).expect("Failed to spawn macro player thread");

    SimulatorSender { immediate_tx, macro_tx, runtime }
}

pub fn spawn_simulator_thread() -> SimulatorSender { spawn_simulator_with_executor(Arc::new(execute_command)) }

fn execute_command(cmd: SimulatorCommand) {
    match cmd {
        SimulatorCommand::PressKey(code) => send_key(code, false),
        SimulatorCommand::ReleaseKey(code) => send_key(code, true),
        SimulatorCommand::MousePress(code) => send_mouse(code, false),
        SimulatorCommand::MouseRelease(code) => send_mouse(code, true),
        SimulatorCommand::TypeString(text) => type_string(&text),
        SimulatorCommand::Delay(ms) => thread::sleep(Duration::from_millis(u64::from(ms))),
        SimulatorCommand::MouseMove { dx, dy } => move_mouse(dx, dy),
        SimulatorCommand::MouseScroll { delta } => scroll_mouse(delta, false),
        SimulatorCommand::MouseAbsolute { x, y } => move_mouse_absolute(x, y),
        SimulatorCommand::RestorePhysicalModifiers { mask } => {
            for vk in crate::daemon::engine::currently_held_modifier_vks(mask) { send_key(vk, false); }
        }
    }
}

#[cfg(target_os = "windows")]
fn send_key(vk: u8, is_keyup: bool) {
    let input = INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 { ki: KEYBDINPUT {
        wVk: windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY(vk as u16), wScan: 0,
        dwFlags: if is_keyup { KEYEVENTF_KEYUP } else { Default::default() }, time: 0, dwExtraInfo: 0,
    }}};
    unsafe { let _ = SendInput(&[input], std::mem::size_of::<INPUT>() as i32); }
}
#[cfg(not(target_os = "windows"))] fn send_key(_vk: u8, _is_keyup: bool) {}

#[cfg(target_os = "windows")]
fn send_mouse(button: u8, is_keyup: bool) {
    let (flags, mouse_data) = match button {
        1 => (if is_keyup { MOUSEEVENTF_LEFTUP } else { MOUSEEVENTF_LEFTDOWN }, 0),
        2 => (if is_keyup { MOUSEEVENTF_RIGHTUP } else { MOUSEEVENTF_RIGHTDOWN }, 0),
        3 => (if is_keyup { MOUSEEVENTF_MIDDLEUP } else { MOUSEEVENTF_MIDDLEDOWN }, 0),
        4 => (if is_keyup { MOUSEEVENTF_XUP } else { MOUSEEVENTF_XDOWN }, 1),
        5 => (if is_keyup { MOUSEEVENTF_XUP } else { MOUSEEVENTF_XDOWN }, 2),
        _ => return,
    };
    let input = INPUT { r#type: INPUT_MOUSE, Anonymous: INPUT_0 { mi: MOUSEINPUT { dx:0, dy:0, mouseData:mouse_data, dwFlags:flags, time:0, dwExtraInfo:0 }}};
    unsafe { let _ = SendInput(&[input], std::mem::size_of::<INPUT>() as i32); }
}
#[cfg(not(target_os = "windows"))] fn send_mouse(_button:u8,_is_keyup:bool) {}

#[cfg(target_os = "windows")]
fn type_string(text: &str) {
    let mut inputs = Vec::with_capacity(text.encode_utf16().count()*2);
    for ch in text.encode_utf16() {
        inputs.push(INPUT { r#type:INPUT_KEYBOARD, Anonymous:INPUT_0 { ki:KEYBDINPUT { wVk:windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY(0), wScan:ch, dwFlags:KEYEVENTF_UNICODE, time:0, dwExtraInfo:0 }}});
        inputs.push(INPUT { r#type:INPUT_KEYBOARD, Anonymous:INPUT_0 { ki:KEYBDINPUT { wVk:windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY(0), wScan:ch, dwFlags:KEYEVENTF_UNICODE|KEYEVENTF_KEYUP, time:0, dwExtraInfo:0 }}});
    }
    if !inputs.is_empty() { unsafe { let _ = SendInput(&inputs, std::mem::size_of::<INPUT>() as i32); } }
}
#[cfg(not(target_os = "windows"))] fn type_string(_text:&str) {}

#[cfg(target_os = "windows")]
fn move_mouse(dx:i32,dy:i32) {
    let input=INPUT{r#type:INPUT_MOUSE,Anonymous:INPUT_0{mi:MOUSEINPUT{dx,dy,mouseData:0,dwFlags:MOUSEEVENTF_MOVE,time:0,dwExtraInfo:0}}};
    unsafe{let _=SendInput(&[input],std::mem::size_of::<INPUT>() as i32);}
}
#[cfg(not(target_os = "windows"))] fn move_mouse(_dx:i32,_dy:i32) {}

#[cfg(target_os = "windows")]
fn scroll_mouse(delta:i32,horizontal:bool) {
    let input=INPUT{r#type:INPUT_MOUSE,Anonymous:INPUT_0{mi:MOUSEINPUT{dx:0,dy:0,mouseData:delta as u32,dwFlags:if horizontal{MOUSEEVENTF_HWHEEL}else{MOUSEEVENTF_WHEEL},time:0,dwExtraInfo:0}}};
    unsafe{let _=SendInput(&[input],std::mem::size_of::<INPUT>() as i32);}
}
#[cfg(not(target_os = "windows"))] fn scroll_mouse(_delta:i32,_horizontal:bool) {}

#[cfg(target_os = "windows")]
fn move_mouse_absolute(x:i32,y:i32) {
    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics,SM_CXSCREEN,SM_CYSCREEN};
    unsafe {
        let w=GetSystemMetrics(SM_CXSCREEN); let h=GetSystemMetrics(SM_CYSCREEN);
        let nx=if w>0{(x*65535)/w}else{0}; let ny=if h>0{(y*65535)/h}else{0};
        let input=INPUT{r#type:INPUT_MOUSE,Anonymous:INPUT_0{mi:MOUSEINPUT{dx:nx,dy:ny,mouseData:0,dwFlags:MOUSEEVENTF_MOVE|MOUSEEVENTF_ABSOLUTE,time:0,dwExtraInfo:0}}};
        let _=SendInput(&[input],std::mem::size_of::<INPUT>() as i32);
    }
}
#[cfg(not(target_os = "windows"))] fn move_mouse_absolute(_x:i32,_y:i32) {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    fn playback(speed:f32, count:u32, held:bool)->MacroPlaybackConfig { MacroPlaybackConfig{speed,repeat_count:count,repeat_while_held:held} }

    #[test]
    fn delay_scaling_is_non_destructive() {
        assert_eq!(scaled_delay_ms(100,2.0),50);
        assert_eq!(scaled_delay_ms(100,0.5),200);
        assert_eq!(scaled_delay_ms(0,2.0),0);
    }

    #[test]
    fn immediate_queue_is_not_blocked_by_macro_delay() {
        let (tx,rx)=mpsc::channel::<String>();
        let ex:CommandExecutor=Arc::new(move|cmd| if let SimulatorCommand::TypeString(s)=cmd{let _=tx.send(s);});
        let sender=spawn_simulator_with_executor(ex);
        sender.send_macro(vec![SimulatorCommand::Delay(150),SimulatorCommand::TypeString("macro".into())],playback(1.0,1,false),1).unwrap();
        sender.send(SimulatorCommand::TypeString("immediate".into())).unwrap();
        assert_eq!(rx.recv_timeout(Duration::from_millis(100)).unwrap(),"immediate");
        assert_eq!(rx.recv_timeout(Duration::from_millis(300)).unwrap(),"macro");
    }

    #[test]
    fn cancellation_releases_held_inputs() {
        let (tx,rx)=mpsc::channel::<SimulatorCommand>();
        let ex:CommandExecutor=Arc::new(move|cmd|{let _=tx.send(cmd);});
        let sender=spawn_simulator_with_executor(ex);
        sender.send_macro(vec![SimulatorCommand::PressKey(0x41),SimulatorCommand::Delay(500)],playback(1.0,1,false),42).unwrap();
        assert_eq!(rx.recv_timeout(Duration::from_millis(100)).unwrap(),SimulatorCommand::PressKey(0x41));
        sender.cancel_macro_key(42);
        assert_eq!(rx.recv_timeout(Duration::from_millis(150)).unwrap(),SimulatorCommand::ReleaseKey(0x41));
    }

    #[test]
    fn repeat_count_reuses_same_command_stream() {
        let (tx,rx)=mpsc::channel::<String>();
        let ex:CommandExecutor=Arc::new(move|cmd|if let SimulatorCommand::TypeString(s)=cmd{let _=tx.send(s);});
        let sender=spawn_simulator_with_executor(ex);
        sender.send_macro(vec![SimulatorCommand::TypeString("x".into())],playback(1.0,3,false),7).unwrap();
        let got=(0..3).map(|_|rx.recv_timeout(Duration::from_millis(200)).unwrap()).collect::<Vec<_>>();
        assert_eq!(got,vec!["x","x","x"]);
    }
}
'''
write('src-tauri/src/simulator/mod.rs', simulator)

# ---------- Engine action playback/cancellation ----------
engine = read('src-tauri/src/daemon/engine.rs')
start = engine.index('            EngineAction::MacroCommands {')
end = engine.index('            EngineAction::ToggleLayer', start)
block = r'''            EngineAction::MacroCommands { commands, playback, macro_key } => {
                if is_down {
                    let mut macro_commands = commands.clone();
                    #[cfg(target_os = "windows")]
                    {
                        if let Some(state_ref) = state {
                            if let Ok(s) = state_ref.read() {
                                if s.restore_mouse_after_macro {
                                    let mut point = windows::Win32::Foundation::POINT { x: 0, y: 0 };
                                    unsafe { let _ = windows::Win32::UI::WindowsAndMessaging::GetCursorPos(&mut point); }
                                    macro_commands.push(SimulatorCommand::MouseAbsolute { x: point.x, y: point.y });
                                }
                            }
                        }
                    }
                    if trigger_modifiers != 0 {
                        macro_commands = isolate_macro_commands(macro_commands, current_physical_modifiers());
                    }
                    let _ = simulator.send_macro(macro_commands, playback.clone(), *macro_key);
                } else if playback.repeat_while_held {
                    simulator.cancel_macro_key(*macro_key);
                }
            }
'''
engine = engine[:start] + block + engine[end:]
write('src-tauri/src/daemon/engine.rs', engine)

# ---------- Emergency stop config ----------
replace_once('src-tauri/src/shared/types.rs',
             '    pub restore_mouse_after_macro: bool,',
             '    pub restore_mouse_after_macro: bool,\n    pub macro_emergency_stop_vk: u8,')
replace_once('src-tauri/src/shared/types.rs',
             '            restore_mouse_after_macro: true,',
             '            restore_mouse_after_macro: true,\n            macro_emergency_stop_vk: 0x13,')
replace_once('src-tauri/src/daemon/state.rs',
             '    pub restore_mouse_after_macro: bool,',
             '    pub restore_mouse_after_macro: bool,\n    pub macro_emergency_stop_vk: u8,')
replace_once('src-tauri/src/daemon/state.rs',
             '            restore_mouse_after_macro: config.restore_mouse_after_macro,',
             '            restore_mouse_after_macro: config.restore_mouse_after_macro,\n            macro_emergency_stop_vk: config.macro_emergency_stop_vk,')
replace_once('src-tauri/src/daemon/state.rs',
             '            restore_mouse_after_macro: true,',
             '            restore_mouse_after_macro: true,\n            macro_emergency_stop_vk: 0x13,')

hooks = read('src-tauri/src/daemon/hooks.rs')
anchor = '            // Перехват F12 для запуска / остановки записи макроса\n'
insert_hook = '''            // Configurable emergency macro stop (Pause by default). Recording F12 remains separate.\n            if is_key_down && vk_code == s.macro_emergency_stop_vk && !s.is_recording.load(Ordering::Relaxed) {\n                if let Some(simulator) = &s.simulator { simulator.cancel_all_macros(); }\n                return LRESULT(1);\n            }\n\n'''
if insert_hook not in hooks:
    hooks = hooks.replace(anchor, insert_hook + anchor, 1)
write('src-tauri/src/daemon/hooks.rs', hooks)

# ---------- Router preview/stop ----------
router = read('src-tauri/src/daemon/router.rs')
router = router.replace('                            actions: vec![FrontendAction::RunMacro {\n                                steps: vec![', '                            actions: vec![FrontendAction::RunMacro {\n                                steps: vec![')
# add playback to onboarding macro after its steps vector
needle = '''                                ],
                            }],
                            hold_actions: None,'''
if needle in router:
    router = router.replace(needle, '''                                ],
                                playback: Default::default(),
                            }],
                            hold_actions: None,''', 1)
preview_methods = r'''        "macro.preview" => {
            let p = params.ok_or_else(|| "Missing parameters".to_string())?;
            let steps = serde_json::from_value::<Vec<crate::schemas::frontend::MacroStep>>(
                p.get("steps").cloned().unwrap_or_else(|| json!([])),
            ).map_err(|e| e.to_string())?;
            let playback = serde_json::from_value::<crate::schemas::frontend::MacroPlayback>(
                p.get("playback").cloned().unwrap_or_else(|| json!({})),
            ).map_err(|e| e.to_string())?;
            let commands = crate::daemon::compiler::compile_macro_commands(&steps);
            let compiled = crate::daemon::compiler::compile_macro_playback(&playback);
            let s = state.read().map_err(|_| "Failed to lock state")?;
            let simulator = s.simulator.as_ref().ok_or_else(|| "Simulator unavailable".to_string())?;
            let job_id = simulator.send_macro(commands, compiled, crate::shared::calculate_hash("macro-preview"))?;
            Ok(json!({ "success": true, "jobId": job_id }))
        }
        "macro.stop_playback" => {
            let s = state.read().map_err(|_| "Failed to lock state")?;
            if let Some(simulator) = &s.simulator { simulator.cancel_current_macro(); }
            Ok(json!({ "success": true }))
        }
        "macro.emergency_stop" => {
            let s = state.read().map_err(|_| "Failed to lock state")?;
            if let Some(simulator) = &s.simulator { simulator.cancel_all_macros(); }
            Ok(json!({ "success": true }))
        }

'''
if '"macro.preview" =>' not in router:
    router = router.replace('        // Macro recording\n', preview_methods + '        // Macro recording\n', 1)
write('src-tauri/src/daemon/router.rs', router)

# ---------- Persistence v2 -> v3 adds explicit macro playback defaults ----------
persistence = read('src-tauri/src/shared/persistence.rs')
persistence = persistence.replace('pub const PROFILE_SCHEMA_VERSION: u32 = 2;', 'pub const PROFILE_SCHEMA_VERSION: u32 = 3;')
case = r'''            2 => {
                // v2 -> v3: macro playback controls. Omitted fields behaved as
                // speed=1, one repeat, not while-held, so migration is lossless.
                if let Some(rules) = object.get_mut("rules").and_then(Value::as_array_mut) {
                    for rule in rules {
                        let Some(rule_obj) = rule.as_object_mut() else { continue; };
                        for action_field in ["actions", "holdActions"] {
                            let Some(actions) = rule_obj.get_mut(action_field).and_then(Value::as_array_mut) else { continue; };
                            for action in actions {
                                let Some(action_obj) = action.as_object_mut() else { continue; };
                                if action_obj.get("type").and_then(Value::as_str) == Some("runMacro") {
                                    action_obj.entry("playback".to_string()).or_insert_with(|| json!({
                                        "speed": 1.0,
                                        "repeatCount": 1,
                                        "repeatWhileHeld": false
                                    }));
                                }
                            }
                        }
                    }
                }
                object.insert("schemaVersion".to_string(), json!(3));
                version = 3;
            }
'''
if 'v2 -> v3: macro playback controls' not in persistence:
    persistence = persistence.replace('            other => return Err(format!("Нет миграции для версии профиля {}", other)),', case + '            other => return Err(format!("Нет миграции для версии профиля {}", other)),', 1)
write('src-tauri/src/shared/persistence.rs', persistence)

# ---------- TS model ----------
types = read('src/lib/types.ts')
if 'export interface MacroPlayback' not in types:
    types = types.replace('export type FrontendAction =', '''export interface MacroPlayback {
  speed: number
  repeatCount: number
  repeatWhileHeld: boolean
}

export type FrontendAction =''', 1)
types = types.replace("  | { type: 'runMacro'; steps: MacroStep[] }", "  | { type: 'runMacro'; steps: MacroStep[]; playback: MacroPlayback }")
types = types.replace('  restoreMouseAfterMacro?: boolean\n', '  restoreMouseAfterMacro?: boolean\n  macroEmergencyStopVk?: number\n')
write('src/lib/types.ts', types)

# ---------- ActionEditor playback controls ----------
action = read('src/components/ruleBuilder/ActionEditor.tsx')
action = action.replace("import { Crosshair, FolderOpen, Trash2 } from 'lucide-react';", "import { Crosshair, FolderOpen, Play, Square, Trash2 } from 'lucide-react';")
action = action.replace("      onChange({ type, steps: [] });", "      onChange({ type, steps: [], playback: { speed: 1, repeatCount: 1, repeatWhileHeld: false } });")
old_bottom = '''      {action.type === 'runMacro' && (
        <div className="border-t border-app-border/70 p-1.5">
          <MacroEditor
            steps={action.steps || []}
            onChange={(steps) => onChange({ ...action, steps })}
          />
        </div>
      )}'''
new_bottom = '''      {action.type === 'runMacro' && (
        <div className="border-t border-app-border/70 p-1.5 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5 border border-app-border bg-app-surface/20 p-1.5 text-[10px]">
            <span className="text-app-muted">{t('macro.playback_speed', { defaultValue: 'Скорость' })}</span>
            <input type="number" min={0.1} max={10} step={0.1} value={action.playback?.speed ?? 1}
              onChange={(event) => onChange({ ...action, playback: { ...(action.playback ?? { speed: 1, repeatCount: 1, repeatWhileHeld: false }), speed: Math.max(0.1, Math.min(10, Number(event.target.value) || 1)) } })}
              className={`${controlClass} w-16 font-mono`} />
            <span className="text-app-muted">{t('macro.repeat_count', { defaultValue: 'Повторы' })}</span>
            <input type="number" min={1} max={10000} value={action.playback?.repeatCount ?? 1}
              disabled={Boolean(action.playback?.repeatWhileHeld)}
              onChange={(event) => onChange({ ...action, playback: { ...(action.playback ?? { speed: 1, repeatCount: 1, repeatWhileHeld: false }), repeatCount: Math.max(1, Math.min(10000, Number.parseInt(event.target.value, 10) || 1)) } })}
              className={`${controlClass} w-20 font-mono`} />
            <label className="inline-flex items-center gap-1 text-app-muted"><input type="checkbox" checked={Boolean(action.playback?.repeatWhileHeld)}
              onChange={(event) => onChange({ ...action, playback: { ...(action.playback ?? { speed: 1, repeatCount: 1, repeatWhileHeld: false }), repeatWhileHeld: event.target.checked } })} />
              {t('macro.repeat_while_held', { defaultValue: 'Пока удерживается' })}</label>
            <div className="ml-auto flex gap-1">
              <button type="button" onClick={() => void invoke('ipc_call', { method: 'macro.preview', params: { steps: action.steps, playback: action.playback ?? { speed: 1, repeatCount: 1, repeatWhileHeld: false } } })}
                className="h-6 px-2 inline-flex items-center gap-1 border border-app-border hover:bg-app-surface"><Play size={10}/>{t('macro.preview', { defaultValue: 'Тест' })}</button>
              <button type="button" onClick={() => void invoke('ipc_call', { method: 'macro.stop_playback' })}
                className="h-6 px-2 inline-flex items-center gap-1 border border-app-border hover:bg-app-surface"><Square size={10}/>{t('macro.stop_playback', { defaultValue: 'Стоп' })}</button>
            </div>
          </div>
          <MacroEditor steps={action.steps || []} onChange={(steps) => onChange({ ...action, steps })} />
        </div>
      )}'''
if old_bottom not in action: raise RuntimeError('ActionEditor macro bottom not found')
action = action.replace(old_bottom, new_bottom, 1)
write('src/components/ruleBuilder/ActionEditor.tsx', action)

# Drag/drop reorder in existing MacroEditor (buttons stay as keyboard-accessible fallback).
macro_editor = read('src/components/ruleBuilder/MacroEditor.tsx')
macro_editor = macro_editor.replace('  const [recordMouseDragDropOnly, setRecordMouseDragDropOnly] = useState(true);', '  const [recordMouseDragDropOnly, setRecordMouseDragDropOnly] = useState(true);\n  const [dragIndex, setDragIndex] = useState<number | null>(null);')
row = '''            <div
              key={index}
              className="min-h-10 px-1.5 py-1.5 flex items-center gap-1.5 border-b last:border-b-0 border-app-border/55 hover:bg-app-surface/20"
            >'''
row_new = '''            <div
              key={index}
              draggable={!isRecording}
              onDragStart={() => setDragIndex(index)}
              onDragEnd={() => setDragIndex(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (dragIndex === null || dragIndex === index) return;
                const next = [...steps];
                const [moving] = next.splice(dragIndex, 1);
                next.splice(index, 0, moving);
                onChange(next);
                setDragIndex(null);
              }}
              className={`min-h-10 px-1.5 py-1.5 flex items-center gap-1.5 border-b last:border-b-0 border-app-border/55 hover:bg-app-surface/20 ${dragIndex === index ? 'opacity-50' : ''}`}
            >'''
if row in macro_editor: macro_editor = macro_editor.replace(row, row_new, 1)
write('src/components/ruleBuilder/MacroEditor.tsx', macro_editor)

# ---------- Mouse trigger UI + defaults ----------
rules = read('src/pages/RulesPage.tsx')
rules = rules.replace("      actions: [{ type: 'runMacro', steps: [] }],", "      actions: [{ type: 'runMacro', steps: [], playback: { speed: 1, repeatCount: 1, repeatWhileHeld: false } }],")
rules = rules.replace("    case 'mouseUp':\n    case 'tapHoldKeyDown':", "    case 'mouseUp':\n    case 'mouseDoubleClick':\n    case 'tapHoldKeyDown':")
rules = rules.replace("    case 'typedText':\n      return `“${trigger.sequence}”`;", "    case 'mouseWheel': return trigger.direction;\n    case 'mouseMove': return `move ≥ ${trigger.minDistance}px`;\n    case 'typedText':\n      return `“${trigger.sequence}”`;")
rules = rules.replace("    case 'mouseUp': return t('rules.trigger_mouse_up');", "    case 'mouseUp': return t('rules.trigger_mouse_up');\n    case 'mouseWheel': return t('ruleBuilder.trigger_types.mouseWheel', { defaultValue: 'Колесо мыши' });\n    case 'mouseDoubleClick': return t('ruleBuilder.trigger_types.mouseDoubleClick', { defaultValue: 'Двойной клик' });\n    case 'mouseMove': return t('ruleBuilder.trigger_types.mouseMove', { defaultValue: 'Движение мыши' });")
rules = rules.replace("  if (type === 'mouseDown') return { ...rule, trigger: { type: 'mouseDown', code: 1 } };\n  return { ...rule, trigger: { type: 'mouseUp', code: 1 } };", "  if (type === 'mouseDown') return { ...rule, trigger: { type: 'mouseDown', code: 1 } };\n  if (type === 'mouseUp') return { ...rule, trigger: { type: 'mouseUp', code: 1 } };\n  if (type === 'mouseWheel') return { ...rule, trigger: { type: 'mouseWheel', direction: 'up' } };\n  if (type === 'mouseDoubleClick') return { ...rule, trigger: { type: 'mouseDoubleClick', code: 1 } };\n  return { ...rule, trigger: { type: 'mouseMove', minDistance: 24, cooldownMs: 120 } };")
rules = rules.replace('''                      <option value="mouseUp">{t('ruleBuilder.trigger_types.mouseUp')}</option>
                      <option value="tapHoldKeyDown">''', '''                      <option value="mouseUp">{t('ruleBuilder.trigger_types.mouseUp')}</option>
                      <option value="mouseWheel">{t('ruleBuilder.trigger_types.mouseWheel', { defaultValue: 'Колесо мыши' })}</option>
                      <option value="mouseDoubleClick">{t('ruleBuilder.trigger_types.mouseDoubleClick', { defaultValue: 'Двойной клик' })}</option>
                      <option value="mouseMove">{t('ruleBuilder.trigger_types.mouseMove', { defaultValue: 'Движение мыши' })}</option>
                      <option value="tapHoldKeyDown">''')
rules = rules.replace("(draftRule.trigger.type === 'mouseDown' || draftRule.trigger.type === 'mouseUp')", "(draftRule.trigger.type === 'mouseDown' || draftRule.trigger.type === 'mouseUp' || draftRule.trigger.type === 'mouseDoubleClick')")
rules = rules.replace("type: draftRule.trigger.type === 'mouseUp' ? 'mouseUp' : 'mouseDown',", "type: draftRule.trigger.type === 'mouseUp' ? 'mouseUp' : draftRule.trigger.type === 'mouseDoubleClick' ? 'mouseDoubleClick' : 'mouseDown',")
# Insert wheel/move controls after mouse button select.
anchor = '''                    )}
                  </div>
                </EditorSection>'''
pos = rules.find("{(draftRule.trigger.type === 'mouseDown'")
end = rules.find(anchor, pos)
if pos >= 0 and end >= 0 and "draftRule.trigger.type === 'mouseWheel'" not in rules[pos:end]:
    extra = '''                    )}
                    {draftRule.trigger.type === 'mouseWheel' && (
                      <select value={draftRule.trigger.direction} disabled={saving}
                        onChange={(event) => setDraftRule({ ...draftRule, trigger: { type: 'mouseWheel', direction: event.target.value as 'up' | 'down' | 'left' | 'right' } })}
                        className={`${selectClass} flex-1 min-w-0 max-w-[520px] disabled:opacity-50`}>
                        <option value="up">{t('ruleBuilder.mouse.wheel_up', { defaultValue: 'Колесо вверх' })}</option>
                        <option value="down">{t('ruleBuilder.mouse.wheel_down', { defaultValue: 'Колесо вниз' })}</option>
                        <option value="left">{t('ruleBuilder.mouse.wheel_left', { defaultValue: 'Горизонтально влево' })}</option>
                        <option value="right">{t('ruleBuilder.mouse.wheel_right', { defaultValue: 'Горизонтально вправо' })}</option>
                      </select>
                    )}
                    {draftRule.trigger.type === 'mouseMove' && (
                      <div className="flex flex-1 items-center gap-1.5 max-w-[520px]">
                        <span className="text-[9px] text-app-muted">px</span>
                        <input type="number" min={1} value={draftRule.trigger.minDistance} disabled={saving}
                          onChange={(event) => setDraftRule({ ...draftRule, trigger: { ...draftRule.trigger, minDistance: Math.max(1, Number.parseInt(event.target.value, 10) || 24) } })}
                          className={`${inputClass} w-24 font-mono`} />
                        <span className="text-[9px] text-app-muted">cooldown ms</span>
                        <input type="number" min={0} value={draftRule.trigger.cooldownMs} disabled={saving}
                          onChange={(event) => setDraftRule({ ...draftRule, trigger: { ...draftRule.trigger, cooldownMs: Math.max(0, Number.parseInt(event.target.value, 10) || 0) } })}
                          className={`${inputClass} w-24 font-mono`} />
                      </div>
                    )}
                  </div>
                </EditorSection>'''
    rules = rules[:end] + extra + rules[end+len(anchor):]
write('src/pages/RulesPage.tsx', rules)

# ---------- Settings emergency-stop picker ----------
settings = read('src/pages/SettingsPage.tsx')
if "../components/ruleBuilder/KeyPicker" not in settings:
    settings = settings.replace("import { triggerToast } from '../lib/toast';", "import { triggerToast } from '../lib/toast';\nimport { KeyPicker } from '../components/ruleBuilder/KeyPicker';")
row_anchor = '''                <SettingRow title={t('settings.restore_mouse')} description={t('settings.restore_mouse_desc')}>
                  <div className="flex justify-end"><Toggle checked={Boolean(config.restoreMouseAfterMacro)} onChange={() => void handleToggle('restoreMouseAfterMacro')} /></div>
                </SettingRow>'''
row_extra = row_anchor + '''
                <SettingRow title={t('settings.macro_emergency_stop', { defaultValue: 'Аварийная остановка макроса' })} description={t('settings.macro_emergency_stop_desc', { defaultValue: 'Эта клавиша немедленно отменяет текущие и ожидающие макросы.' })}>
                  <KeyPicker value={{ code: config.macroEmergencyStopVk ?? 0x13, modifiers: 0 }} allowModifiers={false}
                    onChange={(chord) => setConfig({ macroEmergencyStopVk: chord.code || 0x13 })} className="w-full" />
                </SettingRow>'''
if 'macro_emergency_stop_desc' not in settings:
    settings = settings.replace(row_anchor, row_extra, 1)
write('src/pages/SettingsPage.tsx', settings)

# ---------- i18n ----------
translations = {
 'ru': {'mouseWheel':'Колесо мыши','mouseDoubleClick':'Двойной клик','mouseMove':'Движение мыши','wheel_up':'Колесо вверх','wheel_down':'Колесо вниз','wheel_left':'Горизонтально влево','wheel_right':'Горизонтально вправо','speed':'Скорость','repeat':'Повторы','held':'Пока удерживается','preview':'Тест','stop':'Стоп','estop':'Аварийная остановка макроса','estopd':'Эта клавиша немедленно отменяет текущие и ожидающие макросы.'},
 'en': {'mouseWheel':'Mouse wheel','mouseDoubleClick':'Double click','mouseMove':'Mouse movement','wheel_up':'Wheel up','wheel_down':'Wheel down','wheel_left':'Horizontal left','wheel_right':'Horizontal right','speed':'Speed','repeat':'Repeats','held':'While held','preview':'Test','stop':'Stop','estop':'Macro emergency stop','estopd':'This key immediately cancels the current and queued macros.'},
}
for locale, v in translations.items():
    path=p(f'src/i18n/locales/{locale}.json'); data=json.loads(path.read_text(encoding='utf-8'))
    for k in ('mouseWheel','mouseDoubleClick','mouseMove'): set_nested(data,['ruleBuilder','trigger_types',k],v[k])
    for k in ('wheel_up','wheel_down','wheel_left','wheel_right'): set_nested(data,['ruleBuilder','mouse',k],v[k])
    set_nested(data,['macro','playback_speed'],v['speed']); set_nested(data,['macro','repeat_count'],v['repeat']); set_nested(data,['macro','repeat_while_held'],v['held']); set_nested(data,['macro','preview'],v['preview']); set_nested(data,['macro','stop_playback'],v['stop'])
    set_nested(data,['settings','macro_emergency_stop'],v['estop']); set_nested(data,['settings','macro_emergency_stop_desc'],v['estopd'])
    path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

# Version markers for 0.3.1 checkpoint.
for path in ['package.json','src-tauri/tauri.conf.json']:
    text=read(path).replace('"version": "0.3.0"','"version": "0.3.1"',1); write(path,text)
replace_once('src-tauri/Cargo.toml','version = "0.3.0"','version = "0.3.1"')

print('v0.3.1 macro controls + mouse UI patch applied')
