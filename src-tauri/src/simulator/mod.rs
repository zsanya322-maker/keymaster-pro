use std::sync::mpsc::{self, Sender, Receiver};
use std::thread;
use std::time::Duration;
use tracing::info;

pub mod system;

use crate::schemas::engine::SimulatorCommand;

#[cfg(target_os = "windows")]
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, MOUSEINPUT,
    KEYEVENTF_KEYUP, KEYEVENTF_UNICODE,
    MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP,
    MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP, MOUSEEVENTF_XDOWN, MOUSEEVENTF_XUP,
    MOUSEEVENTF_MOVE, MOUSEEVENTF_WHEEL, MOUSEEVENTF_ABSOLUTE,
};

pub type SimulatorSender = Sender<SimulatorCommand>;

pub fn spawn_simulator_thread() -> SimulatorSender {
    let (tx, rx): (Sender<SimulatorCommand>, Receiver<SimulatorCommand>) = mpsc::channel();

    thread::Builder::new()
        .name("km-simulator".to_string())
        .spawn(move || {
            info!("Simulator thread started.");
            loop {
                match rx.recv() {
                    Ok(cmd) => execute_command(cmd),
                    Err(_) => {
                        info!("Simulator thread channel closed, exiting.");
                        break;
                    }
                }
            }
        })
        .expect("Failed to spawn simulator thread");

    tx
}

fn execute_command(cmd: SimulatorCommand) {
    match cmd {
        SimulatorCommand::PressKey(code) => send_key(code, false),
        SimulatorCommand::ReleaseKey(code) => send_key(code, true),
        SimulatorCommand::MousePress(code) => send_mouse(code, false),
        SimulatorCommand::MouseRelease(code) => send_mouse(code, true),
        SimulatorCommand::TypeString(text) => type_string(&text),
        SimulatorCommand::Delay(ms) => thread::sleep(Duration::from_millis(ms as u64)),
        SimulatorCommand::MouseMove { dx, dy } => move_mouse(dx, dy),
        SimulatorCommand::MouseScroll { delta } => scroll_mouse(delta),
        SimulatorCommand::MouseAbsolute { x, y } => move_mouse_absolute(x, y),
    }
}

#[cfg(target_os = "windows")]
fn send_key(vk: u8, is_keyup: bool) {
    let input = INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY(vk as u16),
                wScan: 0,
                dwFlags: if is_keyup { KEYEVENTF_KEYUP } else { Default::default() },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };

    unsafe {
        SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
    }
}

#[cfg(not(target_os = "windows"))]
fn send_key(_vk: u8, _is_keyup: bool) {
    // Unsupported
}

#[cfg(target_os = "windows")]
fn send_mouse(button: u8, is_keyup: bool) {
    let flags;
    let mut mouse_data = 0;

    match button {
        1 => flags = if is_keyup { MOUSEEVENTF_LEFTUP } else { MOUSEEVENTF_LEFTDOWN },
        2 => flags = if is_keyup { MOUSEEVENTF_RIGHTUP } else { MOUSEEVENTF_RIGHTDOWN },
        3 => flags = if is_keyup { MOUSEEVENTF_MIDDLEUP } else { MOUSEEVENTF_MIDDLEDOWN },
        4 => {
            flags = if is_keyup { MOUSEEVENTF_XUP } else { MOUSEEVENTF_XDOWN };
            mouse_data = 1; // XBUTTON1
        }
        5 => {
            flags = if is_keyup { MOUSEEVENTF_XUP } else { MOUSEEVENTF_XDOWN };
            mouse_data = 2; // XBUTTON2
        }
        _ => return, // Unknown button
    }

    let input = INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx: 0,
                dy: 0,
                mouseData: mouse_data,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };

    unsafe {
        SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
    }
}

#[cfg(not(target_os = "windows"))]
fn send_mouse(_button: u8, _is_keyup: bool) {
    // Unsupported
}

#[cfg(target_os = "windows")]
fn type_string(text: &str) {
    let utf16: Vec<u16> = text.encode_utf16().collect();
    let mut inputs = Vec::with_capacity(utf16.len() * 2);

    for &ch in &utf16 {
        inputs.push(INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY(0),
                    wScan: ch,
                    dwFlags: KEYEVENTF_UNICODE,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        });
        inputs.push(INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY(0),
                    wScan: ch,
                    dwFlags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        });
    }

    if !inputs.is_empty() {
        unsafe {
            SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn type_string(_text: &str) {
    // Unsupported
}

#[cfg(target_os = "windows")]
fn move_mouse(dx: i32, dy: i32) {
    let input = INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx,
                dy,
                mouseData: 0,
                dwFlags: MOUSEEVENTF_MOVE,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    unsafe {
        SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
    }
}

#[cfg(not(target_os = "windows"))]
fn move_mouse(_dx: i32, _dy: i32) {}

#[cfg(target_os = "windows")]
fn scroll_mouse(delta: i32) {
    let input = INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx: 0,
                dy: 0,
                mouseData: delta as u32,
                dwFlags: MOUSEEVENTF_WHEEL,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    unsafe {
        SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
    }
}

#[cfg(not(target_os = "windows"))]
fn scroll_mouse(_delta: i32) {}

#[cfg(target_os = "windows")]
fn move_mouse_absolute(x: i32, y: i32) {
    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};
    unsafe {
        let screen_width = GetSystemMetrics(SM_CXSCREEN);
        let screen_height = GetSystemMetrics(SM_CYSCREEN);
        let normalized_x = if screen_width > 0 { (x * 65535) / screen_width } else { 0 };
        let normalized_y = if screen_height > 0 { (y * 65535) / screen_height } else { 0 };

        let input = INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dx: normalized_x,
                    dy: normalized_y,
                    mouseData: 0,
                    dwFlags: MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
    }
}

#[cfg(not(target_os = "windows"))]
fn move_mouse_absolute(_x: i32, _y: i32) {}

