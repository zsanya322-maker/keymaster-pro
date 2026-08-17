from pathlib import Path
import json

ROOT=Path(__file__).resolve().parents[1]
def R(p): return (ROOT/p).read_text(encoding='utf-8')
def W(p,s): (ROOT/p).write_text(s,encoding='utf-8')
def rep(p,a,b):
    s=R(p)
    if a not in s: raise RuntimeError(f'{p}: missing anchor {a[:100]!r}')
    W(p,s.replace(a,b,1))

# Version sources
for p in ('package.json','src-tauri/tauri.conf.json'):
    s=R(p).replace('"version": "0.3.0"','"version": "0.3.2"').replace('"version": "0.3.1"','"version": "0.3.2"'); W(p,s)
s=R('src-tauri/Cargo.toml').replace('version = "0.3.0"','version = "0.3.2"').replace('version = "0.3.1"','version = "0.3.2"')
# Rich Win32 context APIs
s=s.replace('"Win32_System_Threading",','"Win32_System_Threading",\n    "Win32_System_Com",\n    "Win32_Graphics_Gdi",')
W('src-tauri/Cargo.toml',s)

# Rich shared types/profile bindings/config
p='src-tauri/src/shared/types.rs'; s=R(p)
if 'pub enum MatchMode' not in s:
    s=s.replace('use crate::schemas::frontend::{FrontendRule, LayerMeta, RuleFolder};','use crate::schemas::frontend::{FrontendRule, LayerMeta, RuleFolder};\n\n#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]\n#[serde(rename_all = "camelCase")]\npub enum MatchMode { Any, All }\nimpl Default for MatchMode { fn default() -> Self { Self::Any } }\n\n#[derive(Debug, Clone, Serialize, Deserialize, Default)]\n#[serde(rename_all = "camelCase")]\npub struct ProfileBinding {\n    #[serde(default)] pub process: Option<String>,\n    #[serde(default)] pub path: Option<String>,\n    #[serde(default)] pub title: Option<String>,\n    #[serde(default)] pub class_name: Option<String>,\n    #[serde(default)] pub mode: MatchMode,\n}\n',1)
    s=s.replace('    pub linked_apps: Vec<String>,','    pub linked_apps: Vec<String>,\n    #[serde(default)]\n    pub bindings: Vec<ProfileBinding>,\n    #[serde(default)]\n    pub order: i32,',1)
if 'pub auto_switch_profiles' not in s:
    s=s.replace('    pub macro_emergency_stop_vk: u8,','    pub macro_emergency_stop_vk: u8,\n    pub auto_switch_profiles: bool,\n    pub manual_profile_lock: bool,',1)
    s=s.replace('            macro_emergency_stop_vk: 0x13,','            macro_emergency_stop_vk: 0x13,\n            auto_switch_profiles: false,\n            manual_profile_lock: false,',1)
W(p,s)

# Context model
W('src-tauri/src/context.rs',r'''use std::collections::HashSet;
use std::sync::{Arc, RwLock};

#[derive(Debug, Clone, Default)]
pub struct AppContext {
    pub active_process: String,
    pub active_process_path: String,
    pub active_window_title: String,
    pub active_window_class: String,
    pub window_width: i32,
    pub window_height: i32,
    pub fullscreen: bool,
    pub monitor_id: String,
    pub virtual_desktop_id: String,
    pub active_layers: HashSet<u64>,
}

pub type AppContextState = Arc<RwLock<AppContext>>;
''')

# Profile runtime module for manual/preferred vs runtime + auto match
W('src-tauri/src/daemon/profile_runtime.rs',r'''use crate::context::AppContext;
use crate::daemon::compiler::compile_schema;
use crate::daemon::state::DaemonStateRef;
use crate::schemas::frontend::FrontendConfig;
use crate::shared::types::{MatchMode, Profile, ProfileBinding};

fn contains_ci(value: &str, needle: &str) -> bool { value.to_lowercase().contains(&needle.to_lowercase()) }
fn field(ok: bool, specified: bool, out: &mut Vec<bool>) { if specified { out.push(ok); } }

pub fn binding_matches(binding: &ProfileBinding, ctx: &AppContext) -> bool {
    let mut checks=Vec::new();
    if let Some(v)=binding.process.as_ref().filter(|v|!v.trim().is_empty()) { field(ctx.active_process.eq_ignore_ascii_case(v.trim()),true,&mut checks); }
    if let Some(v)=binding.path.as_ref().filter(|v|!v.trim().is_empty()) { field(contains_ci(&ctx.active_process_path,v.trim()),true,&mut checks); }
    if let Some(v)=binding.title.as_ref().filter(|v|!v.trim().is_empty()) { field(contains_ci(&ctx.active_window_title,v.trim()),true,&mut checks); }
    if let Some(v)=binding.class_name.as_ref().filter(|v|!v.trim().is_empty()) { field(ctx.active_window_class.eq_ignore_ascii_case(v.trim()),true,&mut checks); }
    if checks.is_empty() { return false; }
    match binding.mode { MatchMode::Any => checks.iter().any(|v|*v), MatchMode::All => checks.iter().all(|v|*v) }
}

pub fn profile_matches(profile:&Profile,ctx:&AppContext)->bool {
    if profile.bindings.iter().any(|b|binding_matches(b,ctx)) { return true; }
    profile.linked_apps.iter().any(|p|ctx.active_process.eq_ignore_ascii_case(p))
}

pub fn activate_runtime(state:&DaemonStateRef, profile:Profile)->Result<(),String> {
    let schema=compile_schema(&FrontendConfig { rules:profile.rules.clone(), layers:profile.layers.clone(), tap_hold_timeout_ms:200 });
    let mut s=state.write().map_err(|_|"Failed to lock daemon state".to_string())?;
    s.active_profile_id=profile.id.clone(); s.engine_schema=schema; s.active_profile=Some(profile);
    Ok(())
}

#[cfg(test)]
mod tests {
 use super::*;
 #[test] fn binding_any_all(){ let ctx=AppContext{active_process:"code.exe".into(),active_window_title:"Project - Code".into(),..Default::default()};
   let any=ProfileBinding{process:Some("no.exe".into()),title:Some("Project".into()),mode:MatchMode::Any,..Default::default()}; assert!(binding_matches(&any,&ctx));
   let all=ProfileBinding{process:Some("code.exe".into()),title:Some("Project".into()),mode:MatchMode::All,..Default::default()}; assert!(binding_matches(&all,&ctx));
 }
}
''')
p='src-tauri/src/daemon/mod.rs'; s=R(p)
if 'pub mod profile_runtime;' not in s:s=s.replace('pub mod mouse_triggers;','pub mod mouse_triggers;\npub mod profile_runtime;')
W(p,s)

# Daemon state fields
p='src-tauri/src/daemon/state.rs'; s=R(p)
if 'preferred_profile_id' not in s:
    s=s.replace('    pub active_profile_id: String,','    pub active_profile_id: String,\n    pub preferred_profile_id: String,\n    pub auto_switch_profiles: bool,\n    pub manual_profile_lock: bool,',1)
    s=s.replace('            active_profile_id: config.active_profile_id.clone(),','            active_profile_id: config.active_profile_id.clone(),\n            preferred_profile_id: config.active_profile_id.clone(),\n            auto_switch_profiles: config.auto_switch_profiles,\n            manual_profile_lock: config.manual_profile_lock,',1)
    # test/default initializer secondary pattern
    s=s.replace('            active_profile_id: "1".to_string(),','            active_profile_id: "1".to_string(),\n            preferred_profile_id: "1".to_string(),\n            auto_switch_profiles: false,\n            manual_profile_lock: false,',1)
W(p,s)

# Rich tracker, uses documented IVirtualDesktopManager stable GUID.
W('src-tauri/src/trackers/context_tracker.rs',r'''use std::sync::{Arc, OnceLock, RwLock};
use std::thread;
use tracing::{debug,error,info};
use crate::context::{AppContext,AppContextState};

static GLOBAL_CONTEXT:OnceLock<AppContextState>=OnceLock::new();
pub fn init_context()->AppContextState { let c=Arc::new(RwLock::new(AppContext::default())); let _=GLOBAL_CONTEXT.set(c.clone()); c }
pub fn get_context()->Option<AppContextState>{GLOBAL_CONTEXT.get().cloned()}

#[cfg(target_os="windows")]
mod win {
 use super::*;
 use windows::core::{GUID,HSTRING};
 use windows::Win32::Foundation::{CloseHandle,HWND,LPARAM,WPARAM};
 use windows::Win32::Graphics::Gdi::{GetMonitorInfoW,MonitorFromWindow,MONITORINFO,MONITOR_DEFAULTTONEAREST};
 use windows::Win32::System::Com::{CoCreateInstance,CoInitializeEx,CoUninitialize,CLSCTX_INPROC_SERVER,COINIT_APARTMENTTHREADED};
 use windows::Win32::System::ProcessStatus::K32GetModuleBaseNameW;
 use windows::Win32::System::Threading::{OpenProcess,QueryFullProcessImageNameW,PROCESS_NAME_WIN32,PROCESS_QUERY_INFORMATION,PROCESS_QUERY_LIMITED_INFORMATION,PROCESS_VM_READ};
 use windows::Win32::UI::Accessibility::{SetWinEventHook,UnhookWinEvent,HWINEVENTHOOK,EVENT_SYSTEM_FOREGROUND,WINEVENT_OUTOFCONTEXT};
 use windows::Win32::UI::Shell::IVirtualDesktopManager;
 use windows::Win32::UI::WindowsAndMessaging::{DispatchMessageW,GetClassNameW,GetForegroundWindow,GetMessageW,GetWindowRect,GetWindowTextW,GetWindowThreadProcessId,MSG,RECT,TranslateMessage};

 static mut HOOK:Option<HWINEVENTHOOK>=None;
 const CLSID_VIRTUAL_DESKTOP_MANAGER:GUID=GUID::from_u128(0xaa5090865ca94c258f95589d3c07b48a);

 fn process_info(hwnd:HWND)->(String,String){unsafe{
   let mut pid=0u32; GetWindowThreadProcessId(hwnd,Some(&mut pid)); if pid==0{return(Default::default(),Default::default())}
   if let Ok(h)=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION,false,pid){ let mut buf=[0u16;32768]; let mut size=buf.len() as u32;
     if QueryFullProcessImageNameW(h,PROCESS_NAME_WIN32,windows::core::PWSTR(buf.as_mut_ptr()),&mut size).is_ok(){let path=String::from_utf16_lossy(&buf[..size as usize]);let name=std::path::Path::new(&path).file_name().and_then(|x|x.to_str()).unwrap_or("").to_lowercase();let _=CloseHandle(h);return(name,path)} let _=CloseHandle(h); }
   if let Ok(h)=OpenProcess(PROCESS_QUERY_INFORMATION|PROCESS_VM_READ,false,pid){let mut b=[0u16;260];let n=K32GetModuleBaseNameW(h,None,&mut b);let _=CloseHandle(h);if n>0{return(String::from_utf16_lossy(&b[..n as usize]).to_lowercase(),String::new())}}
   (String::new(),String::new())
 }}
 fn title(hwnd:HWND)->String{unsafe{let mut b=[0u16;1024];let n=GetWindowTextW(hwnd,&mut b);if n>0{String::from_utf16_lossy(&b[..n as usize])}else{String::new()}}}
 fn class(hwnd:HWND)->String{unsafe{let mut b=[0u16;256];let n=GetClassNameW(hwnd,&mut b);if n>0{String::from_utf16_lossy(&b[..n as usize])}else{String::new()}}}
 fn desktop(hwnd:HWND)->String{unsafe{match CoCreateInstance::<_,IVirtualDesktopManager>(&CLSID_VIRTUAL_DESKTOP_MANAGER,None,CLSCTX_INPROC_SERVER).and_then(|m|m.GetWindowDesktopId(hwnd)){Ok(g)=>format!("{:?}",g).to_lowercase(),Err(_)=>String::new()}}}
 fn geometry(hwnd:HWND)->(i32,i32,bool,String){unsafe{let mut r=RECT::default();if GetWindowRect(hwnd,&mut r).is_err(){return(0,0,false,String::new())}let mon=MonitorFromWindow(hwnd,MONITOR_DEFAULTTONEAREST);let mut mi=MONITORINFO{cbSize:std::mem::size_of::<MONITORINFO>() as u32,..Default::default()};let _=GetMonitorInfoW(mon,&mut mi);let full=(r.left-mi.rcMonitor.left).abs()<=1&&(r.top-mi.rcMonitor.top).abs()<=1&&(r.right-mi.rcMonitor.right).abs()<=1&&(r.bottom-mi.rcMonitor.bottom).abs()<=1;let id=format!("{},{},{},{}",mi.rcMonitor.left,mi.rcMonitor.top,mi.rcMonitor.right,mi.rcMonitor.bottom);(r.right-r.left,r.bottom-r.top,full,id)}}
 fn refresh(hwnd:HWND){let Some(ctx)=get_context() else{return};let (process,path)=process_info(hwnd);let t=title(hwnd);let c=class(hwnd);let(w,h,full,monitor)=geometry(hwnd);let vd=desktop(hwnd);if let Ok(mut x)=ctx.write(){x.active_process=process;x.active_process_path=path;x.active_window_title=t;x.active_window_class=c;x.window_width=w;x.window_height=h;x.fullscreen=full;x.monitor_id=monitor;x.virtual_desktop_id=vd;}}
 unsafe extern "system" fn cb(_:HWINEVENTHOOK,_:u32,hwnd:HWND,_:i32,_:i32,_:u32,_:u32){if hwnd.0!=0{refresh(hwnd)}}
 pub fn run(){unsafe{let _=CoInitializeEx(None,COINIT_APARTMENTTHREADED);refresh(GetForegroundWindow());HOOK=SetWinEventHook(EVENT_SYSTEM_FOREGROUND,EVENT_SYSTEM_FOREGROUND,None,Some(cb),0,0,WINEVENT_OUTOFCONTEXT);let mut msg=MSG::default();while GetMessageW(&mut msg,None,0,0).as_bool(){let _=TranslateMessage(&msg);DispatchMessageW(&msg);}if let Some(h)=HOOK.take(){let _=UnhookWinEvent(h);}CoUninitialize();}}
}

pub fn start_context_tracker(){thread::Builder::new().name("context-tracker".into()).spawn(||{info!("Context tracker started");#[cfg(target_os="windows")]win::run();#[cfg(not(target_os="windows"))]loop{thread::sleep(std::time::Duration::from_secs(60));}}).expect("Failed to start context tracker");}
''')

# Frontend/engine rich context condition and modes
p='src-tauri/src/schemas/frontend.rs'; s=R(p)
if 'ContextMatch {' not in s:
    s=s.replace('use serde::{Deserialize, Serialize};','use serde::{Deserialize, Serialize};\nuse crate::shared::types::MatchMode;',1)
    insert='''    ContextMatch {
        #[serde(default)] process: Option<String>, #[serde(default)] path: Option<String>,
        #[serde(default)] title: Option<String>, #[serde(default)] class_name: Option<String>,
        #[serde(default)] virtual_desktop_id: Option<String>, #[serde(default)] monitor_id: Option<String>,
        #[serde(default)] min_width: Option<i32>, #[serde(default)] max_width: Option<i32>,
        #[serde(default)] min_height: Option<i32>, #[serde(default)] max_height: Option<i32>,
        #[serde(default)] fullscreen: Option<bool>, #[serde(default)] mode: MatchMode,
    },
'''
    s=s.replace('    WindowMatch {',insert+'    WindowMatch {',1)
W(p,s)
p='src-tauri/src/schemas/engine.rs'; s=R(p)
if 'ContextMatch {' not in s:
    s=s.replace('use std::collections::HashMap;','use std::collections::HashMap;\nuse crate::shared::types::MatchMode;',1)
    insert='''    ContextMatch {
        process: Option<String>, path: Option<String>, title: Option<String>, class_name: Option<String>,
        virtual_desktop_id: Option<String>, monitor_id: Option<String>,
        min_width: Option<i32>, max_width: Option<i32>, min_height: Option<i32>, max_height: Option<i32>,
        fullscreen: Option<bool>, mode: MatchMode,
    },
'''
    s=s.replace('    WindowMatch {',insert+'    WindowMatch {',1)
W(p,s)

# Compiler ContextMatch
p='src-tauri/src/daemon/compiler.rs'; s=R(p)
if 'FrontendCondition::ContextMatch' not in s:
    anchor='''        FrontendCondition::WindowMatch { process, title } => {'''
    block='''        FrontendCondition::ContextMatch { process, path, title, class_name, virtual_desktop_id, monitor_id, min_width, max_width, min_height, max_height, fullscreen, mode } => EngineCondition::ContextMatch {
            process: process.as_ref().filter(|v|!v.trim().is_empty()).map(|v|v.trim().to_lowercase()),
            path: path.as_ref().filter(|v|!v.trim().is_empty()).map(|v|v.trim().to_lowercase()),
            title: title.as_ref().filter(|v|!v.trim().is_empty()).map(|v|v.trim().to_lowercase()),
            class_name: class_name.as_ref().filter(|v|!v.trim().is_empty()).map(|v|v.trim().to_lowercase()),
            virtual_desktop_id: virtual_desktop_id.clone(), monitor_id: monitor_id.clone(), min_width:*min_width,max_width:*max_width,min_height:*min_height,max_height:*max_height,fullscreen:*fullscreen,mode:mode.clone(),
        },
'''
    s=s.replace(anchor,block+anchor,1)
W(p,s)

# Engine context evaluation
p='src-tauri/src/daemon/engine.rs'; s=R(p)
if 'EngineCondition::ContextMatch' not in s:
    anchor='''            EngineCondition::WindowMatch {
                process_hash,'''
    block='''            EngineCondition::ContextMatch { process,path,title,class_name,virtual_desktop_id,monitor_id,min_width,max_width,min_height,max_height,fullscreen,mode } => {
                let mut checks=Vec::new();
                if let Some(v)=process { checks.push(ctx.active_process.eq_ignore_ascii_case(v)); }
                if let Some(v)=path { checks.push(ctx.active_process_path.to_lowercase().contains(v)); }
                if let Some(v)=title { checks.push(ctx.active_window_title.to_lowercase().contains(v)); }
                if let Some(v)=class_name { checks.push(ctx.active_window_class.eq_ignore_ascii_case(v)); }
                if let Some(v)=virtual_desktop_id { checks.push(ctx.virtual_desktop_id.eq_ignore_ascii_case(v)); }
                if let Some(v)=monitor_id { checks.push(ctx.monitor_id==*v); }
                if let Some(v)=min_width { checks.push(ctx.window_width>=*v); } if let Some(v)=max_width { checks.push(ctx.window_width<=*v); }
                if let Some(v)=min_height { checks.push(ctx.window_height>=*v); } if let Some(v)=max_height { checks.push(ctx.window_height<=*v); }
                if let Some(v)=fullscreen { checks.push(ctx.fullscreen==*v); }
                if checks.is_empty() || match mode { crate::shared::types::MatchMode::Any=>!checks.iter().any(|v|*v), crate::shared::types::MatchMode::All=>!checks.iter().all(|v|*v) } { return false; }
            }
'''
    s=s.replace(anchor,block+anchor,1)
W(p,s)

# Profile persistence schema v4 migration and public backups
p='src-tauri/src/shared/persistence.rs'; s=R(p).replace('pub const PROFILE_SCHEMA_VERSION: u32 = 3;','pub const PROFILE_SCHEMA_VERSION: u32 = 4;',1)
if 'v3 -> v4' not in s:
    case='''            3 => {
                // v3 -> v4: structured profile bindings/order while retaining linkedApps.
                object.entry("order".to_string()).or_insert(json!(0));
                if !object.contains_key("bindings") {
                    let bindings=object.get("linkedApps").and_then(Value::as_array).map(|apps| apps.iter().filter_map(Value::as_str).map(|p|json!({"process":p,"mode":"any"})).collect::<Vec<_>>()).unwrap_or_default();
                    object.insert("bindings".to_string(),json!(bindings));
                }
                object.insert("schemaVersion".to_string(),json!(4)); version=4;
            }
'''
    s=s.replace('            other => return Err(format!("Нет миграции для версии профиля {}", other)),',case+'            other => return Err(format!("Нет миграции для версии профиля {}", other)),',1)
# constructors profile new fields in tests/recovery
s=s.replace('        linked_apps: vec![],\n        rules:', '        linked_apps: vec![],\n        bindings: vec![],\n        order: 0,\n        rules:')
# public backup API
if 'pub fn list_profile_backups' not in s:
    idx=s.index('fn backup_file(')
    api=r'''pub fn list_profile_backups(id:&str)->Result<Vec<String>,String>{profile_path(id)?;let dir=backups_dir()?;let prefix=format!("{}_",id);let mut out=Vec::new();for e in fs::read_dir(&dir).map_err(|e|e.to_string())?{let e=e.map_err(|e|e.to_string())?;let n=e.file_name().to_string_lossy().to_string();if n.starts_with(&prefix)&&n.ends_with(".json"){out.push(n)}}out.sort_by(|a,b|b.cmp(a));Ok(out)}
pub fn create_profile_backup(id:&str)->Result<String,String>{let path=profile_path(id)?;if !path.exists(){return Err("Profile not found".into())}Ok(backup_file(&path)?.file_name().unwrap_or_default().to_string_lossy().to_string())}
pub fn restore_profile_backup(id:&str,name:&str)->Result<Profile,String>{let target=profile_path(id)?;if name.contains('/')||name.contains('\\')||!name.starts_with(&format!("{}_",id))||!name.ends_with(".json"){return Err("Invalid backup name".into())}let src=backups_dir()?.join(name);let data=fs::read_to_string(&src).map_err(|e|e.to_string())?;let value:Value=serde_json::from_str(&data).map_err(|e|e.to_string())?;let(profile,_,_)=profile_from_value(value)?;if profile.id!=id{return Err("Backup profile id mismatch".into())}if target.exists(){let _=backup_file(&target)?;}write_profile_value(&target,&export_profile_value(&profile)?)?;Ok(profile)}

'''
    s=s[:idx]+api+s[idx:]
W(p,s)

# Router profile management; minimal targeted transformations.
p='src-tauri/src/daemon/router.rs'; s=R(p)
s=s.replace('use crate::shared::types::Profile;','use crate::shared::types::{Profile, ProfileBinding};',1)
# ProfileInput fields
if 'bindings: Vec<ProfileBinding>' not in s:
    s=s.replace('    linked_apps: Vec<String>,','    linked_apps: Vec<String>,\n    #[serde(default)] bindings: Vec<ProfileBinding>,\n    #[serde(default)] order: i32,',1)
    s=s.replace('                linked_apps: p.linked_apps,\n                rules:', '                linked_apps: p.linked_apps,\n                bindings: p.bindings,\n                order: p.order,\n                rules:',1)
# list sorted
s=s.replace('            Ok(json!({ "profiles": profiles, "active": active_profile_id }))','''            profiles.sort_by(|a,b|a.order.cmp(&b.order).then_with(||a.name.to_lowercase().cmp(&b.name.to_lowercase())));
            Ok(json!({ "profiles": profiles, "active": active_profile_id }))''',1)
# create defaults alternate constructor occurrence
s=s.replace('                linked_apps: vec![],\n                rules: vec![],', '                linked_apps: vec![],\n                bindings: vec![],\n                order: 0,\n                rules: vec![],',1)
# profile.activate runtime/preferred split
old='''            let profile = persistence::load_profile_checked(id)?;
            let frontend_config = FrontendConfig {
                rules: profile.rules.clone(),
                layers: profile.layers.clone(),
                tap_hold_timeout_ms: 200,
            };
            let schema = compile_schema(&frontend_config);'''
if old in s:
    s=s.replace(old,'            let profile = persistence::load_profile_checked(id)?;',1)
# replace state mutation block if exists through unique markers
old2='''            {
                let mut s = state.write().map_err(|_| "Failed to lock state")?;
                s.active_profile_id = id.to_string();
                s.engine_schema = schema;
                s.active_profile = Some(profile);
            }'''
if old2 in s:
    s=s.replace(old2,'''            crate::daemon::profile_runtime::activate_runtime(state, profile.clone())?;
            { let mut s=state.write().map_err(|_|"Failed to lock state")?; s.preferred_profile_id=id.to_string(); }''',1)
# endpoints before diagnostics
if '"profile.duplicate" =>' not in s:
    anchor='        "diagnostics.create_report" => {'
    endpoints=r'''        "profile.rename" => { let p=params.ok_or("Missing parameters")?;let id=p["id"].as_str().ok_or("Missing id")?;let name=p["name"].as_str().ok_or("Missing name")?.trim();if name.is_empty(){return Err("Name is empty".into())}let mut prof=persistence::load_profile_checked(id)?;prof.name=name.into();persistence::save_profile(&prof)?;update_active_profile_runtime(state,&prof)?;Ok(json!({"success":true})) }
        "profile.duplicate" => { let p=params.ok_or("Missing parameters")?;let id=p["id"].as_str().ok_or("Missing id")?;let new_id=p["newId"].as_str().ok_or("Missing newId")?;let mut prof=persistence::load_profile_checked(id)?;prof.id=new_id.into();prof.name=p["name"].as_str().unwrap_or("Profile copy").into();prof.is_default=false;prof.order+=1;persistence::save_profile(&prof)?;Ok(serde_json::to_value(prof).map_err(|e|e.to_string())?) }
        "profile.reorder" => { let p=params.ok_or("Missing parameters")?;let ids=p["ids"].as_array().ok_or("Missing ids")?;for(i,id)in ids.iter().filter_map(|v|v.as_str()).enumerate(){if let Ok(mut prof)=persistence::load_profile_checked(id){prof.order=i as i32;persistence::save_profile(&prof)?;}}Ok(json!({"success":true})) }
        "profile.backups" => {let p=params.ok_or("Missing parameters")?;let id=p["id"].as_str().ok_or("Missing id")?;Ok(json!({"backups":persistence::list_profile_backups(id)?}))}
        "profile.backup.create" => {let p=params.ok_or("Missing parameters")?;let id=p["id"].as_str().ok_or("Missing id")?;Ok(json!({"name":persistence::create_profile_backup(id)?}))}
        "profile.backup.restore" => {let p=params.ok_or("Missing parameters")?;let id=p["id"].as_str().ok_or("Missing id")?;let name=p["name"].as_str().ok_or("Missing name")?;let prof=persistence::restore_profile_backup(id,name)?;update_active_profile_runtime(state,&prof)?;Ok(serde_json::to_value(prof).map_err(|e|e.to_string())?)}
        "profile.runtime_status" => {let s=state.read().map_err(|_|"Failed to lock state")?;Ok(json!({"active":s.active_profile_id,"preferred":s.preferred_profile_id,"autoSwitch":s.auto_switch_profiles,"manualLock":s.manual_profile_lock}))}

'''
    s=s.replace(anchor,endpoints+anchor,1)
# Rich active window response from context
old='''            Ok(json!({ "process": process, "title": title }))'''
if old in s:
    s=s.replace(old,'''            if let Some(ctx)=crate::trackers::context_tracker::get_context(){if let Ok(c)=ctx.read(){return Ok(json!({"process":c.active_process,"path":c.active_process_path,"title":c.active_window_title,"className":c.active_window_class,"width":c.window_width,"height":c.window_height,"fullscreen":c.fullscreen,"monitorId":c.monitor_id,"virtualDesktopId":c.virtual_desktop_id}))}}
            Ok(json!({ "process": process, "title": title }))''',1)
W(p,s)

# Runner: live config fields + autoswitch loop
p='src-tauri/src/daemon/runner.rs'; s=R(p)
if 'auto_switch_profiles != updated.auto_switch_profiles' not in s:
    s=s.replace('|| s.macro_emergency_stop_vk != updated.macro_emergency_stop_vk','|| s.macro_emergency_stop_vk != updated.macro_emergency_stop_vk\n                    || s.auto_switch_profiles != updated.auto_switch_profiles\n                    || s.manual_profile_lock != updated.manual_profile_lock',1)
    s=s.replace('s.macro_emergency_stop_vk = updated.macro_emergency_stop_vk;','s.macro_emergency_stop_vk = updated.macro_emergency_stop_vk;\n                s.auto_switch_profiles=updated.auto_switch_profiles;\n                s.manual_profile_lock=updated.manual_profile_lock;',1)
# insert auto switch after runtime config sync block marker
marker='''        // Small sleep to prevent busy loop'''
if 'profile_runtime::profile_matches' not in s:
    auto=r'''        // Profile auto-switch changes runtime only; persisted preferred profile stays manual.
        let (auto_switch,manual_lock,preferred,current) = match state.read() { Ok(s)=>(s.auto_switch_profiles,s.manual_profile_lock,s.preferred_profile_id.clone(),s.active_profile_id.clone()), Err(_)=>(false,true,String::new(),String::new()) };
        if auto_switch && !manual_lock {
            if let Some(ctx_arc)=crate::trackers::context_tracker::get_context() { if let Ok(ctx)=ctx_arc.read() {
                if let Ok(ids)=persistence::list_profiles() {
                    let mut target=None;
                    for id in ids { if let Ok(p)=persistence::load_profile_checked(&id) { if crate::daemon::profile_runtime::profile_matches(&p,&ctx) { target=Some(p); break; } } }
                    let target=target.or_else(||persistence::load_profile_checked(&preferred).ok());
                    if let Some(p)=target { if p.id!=current { let _=crate::daemon::profile_runtime::activate_runtime(&state,p); } }
                }
            }}
        }

'''
    s=s.replace(marker,auto+marker,1)
W(p,s)

# TS types/profile store
p='src/lib/types.ts'; s=R(p)
if 'export type MatchMode' not in s:
    s=s.replace('export interface Profile {','''export type MatchMode = 'any' | 'all'
export interface ProfileBinding { process?: string; path?: string; title?: string; className?: string; mode: MatchMode }

export interface Profile {''',1)
    s=s.replace('  linkedApps: string[]','  linkedApps: string[]\n  bindings: ProfileBinding[]\n  order: number',1)
if 'autoSwitchProfiles' not in s:s=s.replace('  macroEmergencyStopVk?: number','  macroEmergencyStopVk?: number\n  autoSwitchProfiles?: boolean\n  manualProfileLock?: boolean',1)
if "type: 'contextMatch'" not in s:
    s=s.replace("  | { type: 'windowMatch'; process?: string; title?: string }","  | { type: 'contextMatch'; process?: string; path?: string; title?: string; className?: string; virtualDesktopId?: string; monitorId?: string; minWidth?: number; maxWidth?: number; minHeight?: number; maxHeight?: number; fullscreen?: boolean; mode: MatchMode }\n  | { type: 'windowMatch'; process?: string; title?: string }",1)
W(p,s)

p='src/store/profileStore.ts'; s=R(p)
# list type stable plus helper actions inserted in interface/store
if 'duplicateProfile:' not in s:
    s=s.replace('  deleteProfile: (id: string) => Promise<void>','  deleteProfile: (id: string) => Promise<void>\n  renameProfile: (id: string, name: string) => Promise<void>\n  duplicateProfile: (id: string, name: string) => Promise<void>\n  reorderProfiles: (ids: string[]) => Promise<void>',1)
    anchor='''  deleteProfile: async (id: string) => {'''
    funcs='''  renameProfile: async (id, name) => { await invoke('ipc_call', { method: 'profile.rename', params: { id, name } }); await get().loadProfiles(); },
  duplicateProfile: async (id, name) => { await invoke('ipc_call', { method: 'profile.duplicate', params: { id, newId: crypto.randomUUID(), name } }); await get().loadProfiles(); },
  reorderProfiles: async (ids) => { await invoke('ipc_call', { method: 'profile.reorder', params: { ids } }); await get().loadProfiles(); },

'''
    s=s.replace(anchor,funcs+anchor,1)
W(p,s)

# App config fallback
p='src/store/appStore.ts'; s=R(p)
if 'autoSwitchProfiles:' not in s:s=s.replace('  macroEmergencyStopVk: 0x13,','  macroEmergencyStopVk: 0x13,\n  autoSwitchProfiles: false,\n  manualProfileLock: false,',1)
W(p,s)

# Profile automation compact Settings component
W('src/components/ProfileAutomationPanel.tsx',r'''import React,{useEffect,useState}from'react';
import{invoke}from'@tauri-apps/api/core';import{Copy,Save,RotateCcw,ArrowUp,ArrowDown}from'lucide-react';
import{useProfileStore}from'../store/profileStore';import{useAppStore}from'../store/appStore';import type{ProfileBinding}from'../lib/types';
export const ProfileAutomationPanel:React.FC=()=>{const{profiles,activeProfileId,saveProfile,renameProfile,duplicateProfile,reorderProfiles}=useProfileStore();const{config,setConfig}=useAppStore();const active=profiles.find(p=>p.id===activeProfileId);const[backups,setBackups]=useState<string[]>([]);
 const loadBackups=async()=>{if(!active)return;const r=await invoke<{backups:string[]}>('ipc_call',{method:'profile.backups',params:{id:active.id}});setBackups(r.backups)};useEffect(()=>{void loadBackups()},[activeProfileId]);if(!active)return null;
 const setBindings=(bindings:ProfileBinding[])=>void saveProfile({...active,bindings});const capture=async()=>{const c=await invoke<any>('ipc_call',{method:'get_active_window'});setBindings([...(active.bindings||[]),{process:c.process,path:c.path,title:'',className:c.className,mode:'all'}])};
 const move=async(d:number)=>{const ids=profiles.map(p=>p.id),i=ids.indexOf(active.id),j=i+d;if(j<0||j>=ids.length)return;[ids[i],ids[j]]=[ids[j],ids[i]];await reorderProfiles(ids)};
 return <div className="space-y-2 text-[10px]"><div className="flex flex-wrap gap-1"><button className="h-7 px-2 border border-app-border" onClick={()=>{const n=prompt('Profile name',active.name);if(n)void renameProfile(active.id,n)}}>Rename</button><button className="h-7 px-2 border border-app-border" onClick={()=>void duplicateProfile(active.id,`${active.name} copy`)}><Copy size={10}/> Duplicate</button><button onClick={()=>void move(-1)} className="h-7 w-7 border border-app-border"><ArrowUp size={11}/></button><button onClick={()=>void move(1)} className="h-7 w-7 border border-app-border"><ArrowDown size={11}/></button></div>
 <label className="flex gap-2 items-center"><input type="checkbox" checked={Boolean(config.autoSwitchProfiles)} onChange={e=>setConfig({autoSwitchProfiles:e.target.checked})}/>Auto-switch profiles</label><label className="flex gap-2 items-center"><input type="checkbox" checked={Boolean(config.manualProfileLock)} onChange={e=>setConfig({manualProfileLock:e.target.checked})}/>Manual profile lock</label>
 <div className="border border-app-border p-2"><div className="flex justify-between mb-1"><b>App/window bindings</b><button onClick={()=>void capture()} className="border border-app-border px-2 h-6">Capture active window</button></div>{(active.bindings||[]).map((b,i)=><div key={i} className="flex gap-1 mb-1"><input className="h-6 flex-1 border border-app-border bg-app-bg px-1" value={b.process||''} onChange={e=>{const n=[...active.bindings];n[i]={...b,process:e.target.value};setBindings(n)}}/><select className="h-6 border border-app-border bg-app-bg" value={b.mode||'any'} onChange={e=>{const n=[...active.bindings];n[i]={...b,mode:e.target.value as any};setBindings(n)}}><option value="any">ANY</option><option value="all">ALL</option></select><button onClick={()=>setBindings(active.bindings.filter((_,x)=>x!==i))}>×</button></div>)}</div>
 <div className="border border-app-border p-2"><div className="flex gap-1"><button onClick={async()=>{await invoke('ipc_call',{method:'profile.backup.create',params:{id:active.id}});await loadBackups()}} className="h-6 px-2 border border-app-border"><Save size={10}/> Backup</button></div>{backups.slice(0,5).map(n=><div key={n} className="flex justify-between mt-1"><span className="truncate">{n}</span><button onClick={async()=>{await invoke('ipc_call',{method:'profile.backup.restore',params:{id:active.id,name:n}});await useProfileStore.getState().loadProfiles()}}><RotateCcw size={10}/></button></div>)}</div></div>}
''')
# Settings import/component
p='src/pages/SettingsPage.tsx'; s=R(p)
if 'ProfileAutomationPanel' not in s:
    s=s.replace("import { KeyPicker } from '../components/ruleBuilder/KeyPicker';","import { KeyPicker } from '../components/ruleBuilder/KeyPicker';\nimport { ProfileAutomationPanel } from '../components/ProfileAutomationPanel';",1)
    # insert after first general Section close before details
    marker='''              <details className="border border-app-border bg-app-bg">'''
    s=s.replace(marker,'''              <Section title={t('settings.profile_automation', { defaultValue: 'Профили и автопереключение' })}><ProfileAutomationPanel /></Section>\n\n'''+marker,1)
W(p,s)

# ConditionEditor add Context Match compact option/fields
p='src/components/ruleBuilder/ConditionEditor.tsx'; s=R(p)
if "value=\"contextMatch\"" not in s:
    s=s.replace('<option value="windowMatch">','<option value="contextMatch">Rich context</option>\n          <option value="windowMatch">',1)
    # changeType helper generic insertion
    s=s.replace("    } else if (type === 'windowMatch') {","    } else if (type === 'contextMatch') {\n      onChange({ type: 'contextMatch', mode: 'all', process: '', title: '' });\n    } else if (type === 'windowMatch') {",1)
    # insert editor before windowMatch
    anchor="            {condition.type === 'windowMatch' && ("
    editor=r'''            {condition.type === 'contextMatch' && (
              <div className="flex-1 min-w-0 flex flex-wrap gap-1"><input className={`${controlClass} flex-1 min-w-[110px]`} placeholder="process.exe" value={condition.process||''} onChange={e=>onChange({...condition,process:e.target.value||undefined})}/><input className={`${controlClass} flex-1 min-w-[110px]`} placeholder="title contains" value={condition.title||''} onChange={e=>onChange({...condition,title:e.target.value||undefined})}/><select className={selectClass} value={condition.mode} onChange={e=>onChange({...condition,mode:e.target.value as any})}><option value="all">ALL</option><option value="any">ANY</option></select><button type="button" className="h-7 px-2 border border-app-border" onClick={async()=>{const c=await invoke<any>('ipc_call',{method:'get_active_window'});onChange({...condition,process:c.process,title:c.title,className:c.className,virtualDesktopId:c.virtualDesktopId,monitorId:c.monitorId})}}>Capture</button></div>
            )}
'''
    s=s.replace(anchor,editor+anchor,1)
W(p,s)

# Tray prev/next quick switch using IPC client.
p='src-tauri/src/gui/tray.rs'; s=R(p)
# safer only if menu creation anchors known; add simple menu items near exit
if 'profile_prev' not in s:
    s=s.replace('let exit_i = MenuItem::with_id(app, "exit",','let prev_i = MenuItem::with_id(app, "profile_prev", "Previous profile", true, None::<&str>)?;\n    let next_i = MenuItem::with_id(app, "profile_next", "Next profile", true, None::<&str>)?;\n    let exit_i = MenuItem::with_id(app, "exit",',1)
    s=s.replace('&exit_i,','&prev_i, &next_i, &exit_i,',1)
    # event handler insert before exit
    anchor='''                "exit" => {'''
    handler=r'''                "profile_prev" | "profile_next" => {
                    let direction=if event.id().as_ref()=="profile_prev"{-1isize}else{1};
                    tauri::async_runtime::spawn(async move { if let Ok(client)=crate::daemon::ipc_client::IpcClient::connect().await { if let Ok(v)=client.call("profile.list",None).await { let arr=v.get("profiles").and_then(|v|v.as_array()).cloned().unwrap_or_default();let active=v.get("active").and_then(|v|v.as_str()).unwrap_or("");if !arr.is_empty(){let i=arr.iter().position(|p|p.get("id").and_then(|v|v.as_str())==Some(active)).unwrap_or(0) as isize;let n=((i+direction).rem_euclid(arr.len() as isize)) as usize;if let Some(id)=arr[n].get("id").and_then(|v|v.as_str()){let _=client.call("profile.activate",Some(serde_json::json!({"id":id}))).await;}} } } });
                }
'''
    s=s.replace(anchor,handler+anchor,1)
W(p,s)

# GUI schema marker v4
p='src/app/App.tsx'; s=R(p).replace('const PROFILE_SCHEMA_VERSION = 1','const PROFILE_SCHEMA_VERSION = 4').replace('const PROFILE_SCHEMA_VERSION = 3','const PROFILE_SCHEMA_VERSION = 4');W(p,s)

print('v0.3.2 profiles/context patch applied')
