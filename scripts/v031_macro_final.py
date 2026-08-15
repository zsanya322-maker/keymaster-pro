from pathlib import Path
import json

ROOT=Path(__file__).resolve().parents[1]
def R(x): return (ROOT/x).read_text(encoding='utf-8')
def W(x,s): (ROOT/x).write_text(s,encoding='utf-8')
def rep(x,a,b,n=1):
    s=R(x)
    if s.count(a)<n: raise RuntimeError(f'{x}: missing anchor {a[:90]!r}')
    W(x,s.replace(a,b,n))

# ---------- persisted macro playback model ----------
f='src-tauri/src/schemas/frontend.rs'; s=R(f)
marker='#[derive(Debug, Clone, Serialize, Deserialize)]\n#[serde(tag = "type", rename_all = "camelCase")]\npub enum FrontendAction {'
if 'pub struct MacroPlayback' not in s:
    s=s.replace(marker,'''fn default_macro_speed() -> f32 { 1.0 }
fn default_macro_repeat_count() -> u32 { 1 }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MacroPlayback {
    pub speed: f32,
    pub repeat_count: u32,
    pub repeat_while_held: bool,
}
impl Default for MacroPlayback {
    fn default() -> Self { Self { speed: default_macro_speed(), repeat_count: default_macro_repeat_count(), repeat_while_held: false } }
}

'''+marker,1)
s=s.replace('    RunMacro { steps: Vec<MacroStep> },','    RunMacro { steps: Vec<MacroStep>, #[serde(default)] playback: MacroPlayback },',1)
W(f,s)

f='src-tauri/src/schemas/engine.rs'; s=R(f)
if 'pub struct MacroPlaybackConfig' not in s:
    s=s.replace('#[derive(Debug, Clone)]\npub enum EngineAction {','''#[derive(Debug, Clone)]
pub struct MacroPlaybackConfig {
    pub speed: f32,
    pub repeat_count: u32,
    pub repeat_while_held: bool,
}
impl Default for MacroPlaybackConfig {
    fn default() -> Self { Self { speed: 1.0, repeat_count: 1, repeat_while_held: false } }
}

#[derive(Debug, Clone)]
pub enum EngineAction {''',1)
s=s.replace('    MacroCommands { commands: Vec<SimulatorCommand> },','    MacroCommands { commands: Vec<SimulatorCommand>, playback: MacroPlaybackConfig, macro_key: u64 },',1)
W(f,s)

# ---------- compiler: production preview and rule playback use same compiler ----------
f='src-tauri/src/daemon/compiler.rs'; s=R(f)
s=s.replace('    EngineSchema, SimulatorCommand,','    EngineSchema, MacroPlaybackConfig, SimulatorCommand,',1)
s=s.replace('    MacroAction, MouseWheelDirection,','    MacroAction, MacroPlayback, MacroStep, MouseWheelDirection,',1)
s=s.replace('let actions = rule.actions.iter().map(compile_action).collect();','let actions = rule.actions.iter().map(|a| compile_action(a, calculate_hash(&rule.id))).collect();',1)
s=s.replace('actions: rule.actions.iter().map(compile_action).collect(),','actions: rule.actions.iter().map(|a| compile_action(a, calculate_hash(&rule.id))).collect(),',1)
s=s.replace('let tap_actions = rule.actions.iter().map(compile_action).collect();','let tap_actions = rule.actions.iter().map(|a| compile_action(a, calculate_hash(&rule.id))).collect();',1)
s=s.replace('.map(|actions| actions.iter().map(compile_action).collect())','.map(|actions| actions.iter().map(|a| compile_action(a, calculate_hash(&rule.id))).collect())',1)
s=s.replace('fn compile_action(action: &FrontendAction) -> EngineAction {','fn compile_action(action: &FrontendAction, macro_key: u64) -> EngineAction {',1)
start=s.index('        FrontendAction::RunMacro { steps } => {')
end=s.index('        FrontendAction::ToggleLayer',start)
new='''        FrontendAction::RunMacro { steps, playback } => EngineAction::MacroCommands {
            commands: compile_macro_commands(steps),
            playback: compile_macro_playback(playback),
            macro_key,
        },
'''
s=s[:start]+new+s[end:]
helper='''pub fn compile_macro_playback(playback: &MacroPlayback) -> MacroPlaybackConfig {
    MacroPlaybackConfig {
        speed: playback.speed.clamp(0.1, 10.0),
        repeat_count: playback.repeat_count.clamp(1, 10_000),
        repeat_while_held: playback.repeat_while_held,
    }
}

pub fn compile_macro_commands(steps: &[MacroStep]) -> Vec<SimulatorCommand> {
    let mut commands=Vec::new();
    for step in steps {
        match step.action {
            MacroAction::KeyDown { code } => commands.push(SimulatorCommand::PressKey(code)),
            MacroAction::KeyUp { code } => commands.push(SimulatorCommand::ReleaseKey(code)),
            MacroAction::MouseDown { code } => commands.push(SimulatorCommand::MousePress(code)),
            MacroAction::MouseUp { code } => commands.push(SimulatorCommand::MouseRelease(code)),
            MacroAction::MouseMove { dx, dy } => commands.push(SimulatorCommand::MouseMove { dx, dy }),
            MacroAction::MouseScroll { delta } => commands.push(SimulatorCommand::MouseScroll { delta }),
            MacroAction::MouseHScroll { delta } => commands.push(SimulatorCommand::MouseHScroll { delta }),
            MacroAction::MouseToAbsolute { x, y } => commands.push(SimulatorCommand::MouseAbsolute { x, y }),
        }
        if step.delay_ms>0 { commands.push(SimulatorCommand::Delay(step.delay_ms)); }
    }
    commands
}

'''
if 'pub fn compile_macro_commands' not in s:
    s=s.replace('fn compile_action(action: &FrontendAction, macro_key: u64) -> EngineAction {',helper+'fn compile_action(action: &FrontendAction, macro_key: u64) -> EngineAction {',1)
W(f,s)

# ---------- simulator job controls, preserving existing SendInput implementation ----------
f='src-tauri/src/simulator/mod.rs'; s=R(f)
s=s.replace('use std::sync::mpsc::{self, Receiver, SendError, Sender};\nuse std::sync::Arc;','use std::collections::HashSet;\nuse std::sync::atomic::{AtomicU64, Ordering};\nuse std::sync::mpsc::{self, Receiver, SendError, Sender};\nuse std::sync::{Arc, Mutex};',1)
s=s.replace('use crate::schemas::engine::SimulatorCommand;','use crate::schemas::engine::{MacroPlaybackConfig, SimulatorCommand};',1)
start=s.index('#[derive(Clone)]\npub struct SimulatorSender')
end=s.index('pub fn spawn_simulator_thread()',start)
prefix='''#[derive(Debug, Clone)]
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
    fn fmt(&self,f:&mut std::fmt::Formatter<'_>)->std::fmt::Result { f.debug_struct("SimulatorSender").finish_non_exhaustive() }
}
impl SimulatorSender {
    pub fn send(&self,command:SimulatorCommand)->Result<(),SendError<SimulatorCommand>> { self.immediate_tx.send(command) }
    pub fn send_macro(&self,commands:Vec<SimulatorCommand>)->Result<(),String> {
        self.send_macro_with_options(commands,MacroPlaybackConfig::default(),0).map(|_|())
    }
    pub fn send_macro_with_options(&self,commands:Vec<SimulatorCommand>,playback:MacroPlaybackConfig,macro_key:u64)->Result<u64,String> {
        if let Ok(mut keys)=self.runtime.cancelled_keys.lock(){ keys.remove(&macro_key); }
        let id=self.runtime.next_id.fetch_add(1,Ordering::Relaxed).wrapping_add(1);
        let job=MacroJob{id,macro_key,generation:self.runtime.generation.load(Ordering::Acquire),commands,playback};
        self.macro_tx.send(job).map_err(|e|e.to_string())?; Ok(id)
    }
    pub fn cancel_macro_key(&self,key:u64){ if let Ok(mut keys)=self.runtime.cancelled_keys.lock(){keys.insert(key);} }
    pub fn cancel_current_macro(&self){ let id=self.runtime.active_id.load(Ordering::Acquire); if id!=0 { if let Ok(mut ids)=self.runtime.cancelled_ids.lock(){ids.insert(id);} } }
    pub fn cancel_all_macros(&self){ self.runtime.generation.fetch_add(1,Ordering::AcqRel); self.cancel_current_macro(); }
}

type CommandExecutor=Arc<dyn Fn(SimulatorCommand)+Send+Sync+'static>;
fn cancelled(rt:&MacroRuntime,j:&MacroJob)->bool {
    rt.generation.load(Ordering::Acquire)!=j.generation
      || rt.cancelled_ids.lock().map(|x|x.contains(&j.id)).unwrap_or(true)
      || rt.cancelled_keys.lock().map(|x|x.contains(&j.macro_key)).unwrap_or(true)
}
fn scaled_delay(ms:u32,speed:f32)->u32 { if ms==0 {0} else {((ms as f32/speed.clamp(0.1,10.0)).round() as u32).max(1)} }
fn release_held(ex:&CommandExecutor,keys:&mut HashSet<u8>,buttons:&mut HashSet<u8>){
    for k in keys.drain(){ex(SimulatorCommand::ReleaseKey(k));}
    for b in buttons.drain(){ex(SimulatorCommand::MouseRelease(b));}
}
fn execute_macro_job(j:&MacroJob,rt:&MacroRuntime,ex:&CommandExecutor){
    let mut keys=HashSet::new(); let mut buttons=HashSet::new(); let mut repeats=0u32;
    'outer: loop {
        if cancelled(rt,j){break;}
        for c in &j.commands {
            if cancelled(rt,j){break 'outer;}
            match c {
                SimulatorCommand::Delay(ms)=>{let mut left=scaled_delay(*ms,j.playback.speed); while left>0 {if cancelled(rt,j){break 'outer;} let slice=left.min(10); thread::sleep(Duration::from_millis(slice as u64)); left-=slice;}},
                SimulatorCommand::PressKey(k)=>{keys.insert(*k);ex(c.clone());}, SimulatorCommand::ReleaseKey(k)=>{keys.remove(k);ex(c.clone());},
                SimulatorCommand::MousePress(b)=>{buttons.insert(*b);ex(c.clone());}, SimulatorCommand::MouseRelease(b)=>{buttons.remove(b);ex(c.clone());},
                _=>ex(c.clone()),
            }
        }
        repeats=repeats.saturating_add(1);
        if !j.playback.repeat_while_held && repeats>=j.playback.repeat_count.max(1){break;}
    }
    release_held(ex,&mut keys,&mut buttons);
    if let Ok(mut ids)=rt.cancelled_ids.lock(){ids.remove(&j.id);}
}
fn spawn_simulator_with_executor(executor:CommandExecutor)->SimulatorSender {
    let (immediate_tx,immediate_rx):(Sender<SimulatorCommand>,Receiver<SimulatorCommand>)=mpsc::channel();
    let (macro_tx,macro_rx):(Sender<MacroJob>,Receiver<MacroJob>)=mpsc::channel();
    let runtime=Arc::new(MacroRuntime::default());
    let ie=Arc::clone(&executor);
    thread::Builder::new().name("km-simulator".into()).spawn(move||{info!("Immediate simulator thread started.");while let Ok(c)=immediate_rx.recv(){ie(c);}}).expect("Failed to spawn simulator thread");
    let rt=Arc::clone(&runtime);
    thread::Builder::new().name("km-macro-player".into()).spawn(move||{info!("Macro player thread started.");while let Ok(j)=macro_rx.recv(){rt.active_id.store(j.id,Ordering::Release);execute_macro_job(&j,&rt,&executor);rt.active_id.store(0,Ordering::Release);}}).expect("Failed to spawn macro player thread");
    SimulatorSender{immediate_tx,macro_tx,runtime}
}

'''
s=s[:start]+prefix+s[end:]
# adapt existing tests to Result<String> is transparent; signatures unchanged
# add focused cancellation/speed/repeat tests before final module brace
idx=s.rfind('\n}')
tests='''

    #[test]
    fn playback_delay_scaling_is_stable() {
        assert_eq!(scaled_delay(100,2.0),50); assert_eq!(scaled_delay(100,0.5),200); assert_eq!(scaled_delay(0,2.0),0);
    }

    #[test]
    fn cancellation_releases_held_key() {
        let (tx,rx)=mpsc::channel::<SimulatorCommand>();
        let ex:CommandExecutor=Arc::new(move|c|{let _=tx.send(c);});
        let sender=spawn_simulator_with_executor(ex);
        sender.send_macro_with_options(vec![SimulatorCommand::PressKey(0x41),SimulatorCommand::Delay(500)],MacroPlaybackConfig::default(),42).unwrap();
        assert_eq!(rx.recv_timeout(Duration::from_millis(100)).unwrap(),SimulatorCommand::PressKey(0x41));
        sender.cancel_macro_key(42);
        assert_eq!(rx.recv_timeout(Duration::from_millis(200)).unwrap(),SimulatorCommand::ReleaseKey(0x41));
    }

    #[test]
    fn repeat_count_is_deterministic() {
        let (tx,rx)=mpsc::channel::<String>();
        let ex:CommandExecutor=Arc::new(move|c|if let SimulatorCommand::TypeString(v)=c{let _=tx.send(v);});
        let sender=spawn_simulator_with_executor(ex);
        sender.send_macro_with_options(vec![SimulatorCommand::TypeString("x".into())],MacroPlaybackConfig{speed:1.0,repeat_count:3,repeat_while_held:false},7).unwrap();
        assert_eq!((0..3).map(|_|rx.recv_timeout(Duration::from_millis(200)).unwrap()).collect::<Vec<_>>(),vec!["x","x","x"]);
    }
'''
s=s[:idx]+tests+s[idx:]
W(f,s)

# ---------- engine starts controlled jobs, release cancels while-held ----------
f='src-tauri/src/daemon/engine.rs'; s=R(f)
start=s.index('            EngineAction::MacroCommands { commands } => {')
end=s.index('            EngineAction::ToggleLayer',start)
block='''            EngineAction::MacroCommands { commands, playback, macro_key } => {
                if is_down {
                    let mut macro_commands=commands.clone();
                    #[cfg(target_os = "windows")]
                    if let Some(state_ref)=state { if let Ok(st)=state_ref.read() { if st.restore_mouse_after_macro {
                        let mut point=windows::Win32::Foundation::POINT{x:0,y:0}; unsafe {let _=windows::Win32::UI::WindowsAndMessaging::GetCursorPos(&mut point);}
                        macro_commands.push(SimulatorCommand::MouseAbsolute{x:point.x,y:point.y});
                    }}}
                    if trigger_modifiers!=0 { macro_commands=isolate_macro_commands(macro_commands,current_physical_modifiers()); }
                    let _=simulator.send_macro_with_options(macro_commands,playback.clone(),*macro_key);
                } else if playback.repeat_while_held { simulator.cancel_macro_key(*macro_key); }
            }
'''
s=s[:start]+block+s[end:]
W(f,s)

# ---------- migration v3 ----------
f='src-tauri/src/shared/persistence.rs'; s=R(f).replace('pub const PROFILE_SCHEMA_VERSION: u32 = 2;','pub const PROFILE_SCHEMA_VERSION: u32 = 3;',1)
case='''            2 => {
                if let Some(rules)=object.get_mut("rules").and_then(Value::as_array_mut) {
                    for rule in rules {
                        let Some(ro)=rule.as_object_mut() else {continue;};
                        for field in ["actions","holdActions"] {
                            let Some(actions)=ro.get_mut(field).and_then(Value::as_array_mut) else {continue;};
                            for action in actions {
                                let Some(a)=action.as_object_mut() else {continue;};
                                if a.get("type").and_then(Value::as_str)==Some("runMacro") {
                                    a.entry("playback".to_string()).or_insert_with(||json!({"speed":1.0,"repeatCount":1,"repeatWhileHeld":false}));
                                }
                            }
                        }
                    }
                }
                object.insert("schemaVersion".to_string(),json!(3)); version=3;
            }
'''
if 'schemaVersion".to_string(),json!(3)' not in s:
    s=s.replace('            other => return Err(format!("Нет миграции для версии профиля {}", other)),',case+'            other => return Err(format!("Нет миграции для версии профиля {}", other)),',1)
W(f,s)

# ---------- router preview/stop + onboarding default ----------
f='src-tauri/src/daemon/router.rs'; s=R(f)
s=s.replace('FrontendAction::RunMacro {\n                                steps: vec![','FrontendAction::RunMacro {\n                                steps: vec![',1)
needle='''                                ],
                            }],
                            hold_actions: None,'''
if needle in s: s=s.replace(needle,'''                                ],
                                playback: Default::default(),
                            }],
                            hold_actions: None,''',1)
if '"macro.preview" =>' not in s:
    methods='''        "macro.preview" => {
            let p=params.ok_or_else(||"Missing parameters".to_string())?;
            let steps=serde_json::from_value::<Vec<crate::schemas::frontend::MacroStep>>(p.get("steps").cloned().unwrap_or_else(||json!([]))).map_err(|e|e.to_string())?;
            let playback=serde_json::from_value::<crate::schemas::frontend::MacroPlayback>(p.get("playback").cloned().unwrap_or_else(||json!({}))).map_err(|e|e.to_string())?;
            let commands=crate::daemon::compiler::compile_macro_commands(&steps); let opts=crate::daemon::compiler::compile_macro_playback(&playback);
            let st=state.read().map_err(|_|"Failed to lock state")?; let sim=st.simulator.as_ref().ok_or_else(||"Simulator unavailable".to_string())?;
            let id=sim.send_macro_with_options(commands,opts,crate::shared::calculate_hash("macro-preview"))?; Ok(json!({"success":true,"jobId":id}))
        }
        "macro.stop_playback" => { let st=state.read().map_err(|_|"Failed to lock state")?; if let Some(sim)=&st.simulator{sim.cancel_current_macro();} Ok(json!({"success":true})) }
        "macro.emergency_stop" => { let st=state.read().map_err(|_|"Failed to lock state")?; if let Some(sim)=&st.simulator{sim.cancel_all_macros();} Ok(json!({"success":true})) }

'''
    s=s.replace('        // Macro recording\n',methods+'        // Macro recording\n',1)
W(f,s)

# ---------- configurable emergency stop ----------
f='src-tauri/src/shared/types.rs'; s=R(f)
if 'macro_emergency_stop_vk' not in s:
    s=s.replace('    pub restore_mouse_after_macro: bool,','    pub restore_mouse_after_macro: bool,\n    pub macro_emergency_stop_vk: u8,',1)
    s=s.replace('            restore_mouse_after_macro: true,','            restore_mouse_after_macro: true,\n            macro_emergency_stop_vk: 0x13,',1)
W(f,s)
f='src-tauri/src/daemon/state.rs'; s=R(f)
if 'macro_emergency_stop_vk' not in s:
    s=s.replace('    pub restore_mouse_after_macro: bool,','    pub restore_mouse_after_macro: bool,\n    pub macro_emergency_stop_vk: u8,',1)
    s=s.replace('            restore_mouse_after_macro: config.restore_mouse_after_macro,','            restore_mouse_after_macro: config.restore_mouse_after_macro,\n            macro_emergency_stop_vk: config.macro_emergency_stop_vk,',1)
    s=s.replace('            restore_mouse_after_macro: true,','            restore_mouse_after_macro: true,\n            macro_emergency_stop_vk: 0x13,',1)
W(f,s)
f='src-tauri/src/daemon/hooks.rs'; s=R(f)
if 'macro_emergency_stop_vk' not in s:
    anchor='            // Перехват F12 для запуска / остановки записи макроса\n'
    s=s.replace(anchor,'''            if is_key_down && vk_code == s.macro_emergency_stop_vk && !s.is_recording.load(Ordering::Relaxed) {
                if let Some(sim)=&s.simulator { sim.cancel_all_macros(); }
                return LRESULT(1);
            }

'''+anchor,1)
W(f,s)

# ---------- TS model/UI ----------
f='src/lib/types.ts'; s=R(f)
if 'export interface MacroPlayback' not in s:
    s=s.replace('export type FrontendAction =','''export interface MacroPlayback {
  speed: number
  repeatCount: number
  repeatWhileHeld: boolean
}

export type FrontendAction =''',1)
s=s.replace("  | { type: 'runMacro'; steps: MacroStep[] }","  | { type: 'runMacro'; steps: MacroStep[]; playback: MacroPlayback }",1)
if 'macroEmergencyStopVk' not in s:s=s.replace('  restoreMouseAfterMacro?: boolean\n','  restoreMouseAfterMacro?: boolean\n  macroEmergencyStopVk?: number\n',1)
W(f,s)

f='src/components/ruleBuilder/ActionEditor.tsx'; s=R(f)
s=s.replace("import { Crosshair, FolderOpen, Trash2 } from 'lucide-react';","import { Crosshair, FolderOpen, Play, Square, Trash2 } from 'lucide-react';",1)
s=s.replace("      onChange({ type, steps: [] });","      onChange({ type, steps: [], playback: { speed: 1, repeatCount: 1, repeatWhileHeld: false } });",1)
old='''      {action.type === 'runMacro' && (
        <div className="border-t border-app-border/70 p-1.5">
          <MacroEditor
            steps={action.steps || []}
            onChange={(steps) => onChange({ ...action, steps })}
          />
        </div>
      )}'''
new='''      {action.type === 'runMacro' && (
        <div className="border-t border-app-border/70 p-1.5 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5 border border-app-border bg-app-surface/20 p-1.5 text-[10px]">
            <span className="text-app-muted">{t('macro.playback_speed', { defaultValue: 'Скорость' })}</span>
            <input type="number" min={0.1} max={10} step={0.1} value={action.playback?.speed ?? 1} onChange={(e)=>onChange({...action,playback:{...(action.playback??{speed:1,repeatCount:1,repeatWhileHeld:false}),speed:Math.max(.1,Math.min(10,Number(e.target.value)||1))}})} className={`${controlClass} w-16 font-mono`} />
            <span className="text-app-muted">{t('macro.repeat_count', { defaultValue: 'Повторы' })}</span>
            <input type="number" min={1} max={10000} disabled={Boolean(action.playback?.repeatWhileHeld)} value={action.playback?.repeatCount ?? 1} onChange={(e)=>onChange({...action,playback:{...(action.playback??{speed:1,repeatCount:1,repeatWhileHeld:false}),repeatCount:Math.max(1,Math.min(10000,Number.parseInt(e.target.value,10)||1))}})} className={`${controlClass} w-20 font-mono`} />
            <label className="inline-flex items-center gap-1 text-app-muted"><input type="checkbox" checked={Boolean(action.playback?.repeatWhileHeld)} onChange={(e)=>onChange({...action,playback:{...(action.playback??{speed:1,repeatCount:1,repeatWhileHeld:false}),repeatWhileHeld:e.target.checked}})} />{t('macro.repeat_while_held', { defaultValue: 'Пока удерживается' })}</label>
            <div className="ml-auto flex gap-1">
              <button type="button" onClick={()=>void invoke('ipc_call',{method:'macro.preview',params:{steps:action.steps,playback:action.playback??{speed:1,repeatCount:1,repeatWhileHeld:false}}})} className="h-6 px-2 inline-flex items-center gap-1 border border-app-border hover:bg-app-surface"><Play size={10}/>{t('macro.preview',{defaultValue:'Тест'})}</button>
              <button type="button" onClick={()=>void invoke('ipc_call',{method:'macro.stop_playback'})} className="h-6 px-2 inline-flex items-center gap-1 border border-app-border hover:bg-app-surface"><Square size={10}/>{t('macro.stop_playback',{defaultValue:'Стоп'})}</button>
            </div>
          </div>
          <MacroEditor steps={action.steps || []} onChange={(steps) => onChange({ ...action, steps })} />
        </div>
      )}'''
if old not in s: raise RuntimeError('ActionEditor macro block anchor changed')
s=s.replace(old,new,1); W(f,s)

# RulesPage new macro default
f='src/pages/RulesPage.tsx'; s=R(f)
s=s.replace("actions: [{ type: 'runMacro', steps: [] }],","actions: [{ type: 'runMacro', steps: [], playback: { speed: 1, repeatCount: 1, repeatWhileHeld: false } }],",1)
W(f,s)

# drag/drop macro steps
f='src/components/ruleBuilder/MacroEditor.tsx'; s=R(f)
if 'dragIndex' not in s:
    s=s.replace('  const [recordMouseDragDropOnly, setRecordMouseDragDropOnly] = useState(true);','  const [recordMouseDragDropOnly, setRecordMouseDragDropOnly] = useState(true);\n  const [dragIndex, setDragIndex] = useState<number | null>(null);',1)
    row='''            <div
              key={index}
              className="min-h-10 px-1.5 py-1.5 flex items-center gap-1.5 border-b last:border-b-0 border-app-border/55 hover:bg-app-surface/20"
            >'''
    newrow='''            <div
              key={index}
              draggable={!isRecording}
              onDragStart={() => setDragIndex(index)} onDragEnd={() => setDragIndex(null)} onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => { event.preventDefault(); if (dragIndex === null || dragIndex === index) return; const next=[...steps]; const [moving]=next.splice(dragIndex,1); next.splice(index,0,moving); onChange(next); setDragIndex(null); }}
              className={`min-h-10 px-1.5 py-1.5 flex items-center gap-1.5 border-b last:border-b-0 border-app-border/55 hover:bg-app-surface/20 ${dragIndex === index ? 'opacity-50' : ''}`}
            >'''
    if row in s:s=s.replace(row,newrow,1)
W(f,s)

# Settings picker
f='src/pages/SettingsPage.tsx'; s=R(f)
if "../components/ruleBuilder/KeyPicker" not in s:s=s.replace("import { triggerToast } from '../lib/toast';","import { triggerToast } from '../lib/toast';\nimport { KeyPicker } from '../components/ruleBuilder/KeyPicker';",1)
anchor='''                <SettingRow title={t('settings.restore_mouse')} description={t('settings.restore_mouse_desc')}>
                  <div className="flex justify-end"><Toggle checked={Boolean(config.restoreMouseAfterMacro)} onChange={() => void handleToggle('restoreMouseAfterMacro')} /></div>
                </SettingRow>'''
if 'macroEmergencyStopVk' not in s:
    s=s.replace(anchor,anchor+'''\n                <SettingRow title={t('settings.macro_emergency_stop', { defaultValue: 'Аварийная остановка макроса' })} description={t('settings.macro_emergency_stop_desc', { defaultValue: 'Немедленно отменяет текущие и ожидающие макросы.' })}>
                  <KeyPicker value={{ code: config.macroEmergencyStopVk ?? 0x13, modifiers: 0 }} allowModifiers={false} onChange={(chord) => setConfig({ macroEmergencyStopVk: chord.code || 0x13 })} className="w-full" />
                </SettingRow>''',1)
W(f,s)

# i18n parity
for loc,v in {'ru':('Скорость','Повторы','Пока удерживается','Тест','Стоп','Аварийная остановка макроса','Немедленно отменяет текущие и ожидающие макросы.'),'en':('Speed','Repeats','While held','Test','Stop','Macro emergency stop','Immediately cancels current and queued macros.')}.items():
    f=f'src/i18n/locales/{loc}.json'; d=json.loads(R(f));
    d.setdefault('macro',{}).update(dict(zip(['playback_speed','repeat_count','repeat_while_held','preview','stop_playback'],v[:5])))
    d.setdefault('settings',{}).update({'macro_emergency_stop':v[5],'macro_emergency_stop_desc':v[6]}); W(f,json.dumps(d,ensure_ascii=False,indent=2)+'\n')

# version
for f in ['package.json','src-tauri/tauri.conf.json']: W(f,R(f).replace('"version": "0.3.0"','"version": "0.3.1"',1))
W('src-tauri/Cargo.toml',R('src-tauri/Cargo.toml').replace('version = "0.3.0"','version = "0.3.1"',1))
print('v0.3.1 final macro patch applied')
