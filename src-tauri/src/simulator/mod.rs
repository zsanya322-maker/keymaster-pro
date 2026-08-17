use std::sync::Arc;
use std::sync::mpsc::{self, Receiver, SendError, Sender};
use std::thread;
use std::time::Duration;
use tracing::info;

pub mod macro_player;
pub mod system;

use self::macro_player::{MacroExecutor, MacroPlayer};
use crate::schemas::engine::{MacroPlaybackConfig, SimulatorCommand};

#[cfg(target_os = "windows")]
use windows::Win32::UI::Input::KeyboardAndMouse::{
    INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE,
    MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_HWHEEL, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP,
    MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP, MOUSEEVENTF_MOVE, MOUSEEVENTF_RIGHTDOWN,
    MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_WHEEL, MOUSEEVENTF_XDOWN, MOUSEEVENTF_XUP, MOUSEINPUT,
    SendInput,
};

/// Два независимых канала симуляции.
///
/// `immediate_tx` обслуживает короткие реакции на хук (обычный remap, media,
/// text expansion) и не должен ждать `Delay` из длинного макроса.
/// `macro_tx` последовательно воспроизводит целые макросы на отдельном worker.
#[derive(Clone)]
pub struct SimulatorSender {
    immediate_tx: Sender<SimulatorCommand>,
    macro_player: MacroPlayer,
}

impl std::fmt::Debug for SimulatorSender {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SimulatorSender").finish_non_exhaustive()
    }
}

impl SimulatorSender {
    /// Отправить мгновенную команду. Сигнатура намеренно похожа на mpsc::Sender,
    /// чтобы существующие места вызова не усложнять.
    pub fn send(&self, command: SimulatorCommand) -> Result<(), SendError<SimulatorCommand>> {
        self.immediate_tx.send(command)
    }

    /// Поставить в очередь macro-job. Delay/repeat/cancellation живут только в
    /// macro-player и никогда не блокируют immediate remap queue.
    pub fn send_macro(
        &self,
        commands: Vec<SimulatorCommand>,
        playback: MacroPlaybackConfig,
        macro_key: u64,
    ) -> Result<u64, String> {
        self.macro_player.enqueue(commands, playback, macro_key)
    }

    pub fn cancel_macro_key(&self, macro_key: u64) {
        self.macro_player.cancel_macro_key(macro_key);
    }

    pub fn cancel_current_macro(&self) {
        self.macro_player.cancel_current();
    }

    pub fn cancel_all_macros(&self) {
        self.macro_player.cancel_all();
    }
}

/// Внутренний конструктор worker'ов с внедряемым executor.
///
/// В production executor вызывает Win32 SendInput. В тестах можно подставить
/// детерминированный наблюдатель и проверить именно архитектуру очередей, не
/// генерируя реальные нажатия клавиш на CI-машине.
fn spawn_simulator_with_executor(executor: MacroExecutor) -> SimulatorSender {
    let (immediate_tx, immediate_rx): (Sender<SimulatorCommand>, Receiver<SimulatorCommand>) =
        mpsc::channel();
    let macro_player = MacroPlayer::spawn(Arc::clone(&executor));

    let immediate_executor = Arc::clone(&executor);
    thread::Builder::new()
        .name("km-simulator".to_string())
        .spawn(move || {
            info!("Immediate simulator thread started.");
            while let Ok(command) = immediate_rx.recv() {
                immediate_executor(command);
            }
            info!("Immediate simulator thread channel closed, exiting.");
        })
        .expect("Failed to spawn simulator thread");

    SimulatorSender {
        immediate_tx,
        macro_player,
    }
}

pub fn spawn_simulator_thread() -> SimulatorSender {
    spawn_simulator_with_executor(Arc::new(execute_command))
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
        SimulatorCommand::MouseScroll { delta } => scroll_mouse(delta, false),
        SimulatorCommand::MouseHScroll { delta } => scroll_mouse(delta, true),
        SimulatorCommand::MouseAbsolute { x, y } => move_mouse_absolute(x, y),
        SimulatorCommand::RestorePhysicalModifiers { mask } => {
            for vk in crate::daemon::engine::currently_held_modifier_vks(mask) {
                send_key(vk, false);
            }
        }
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
                dwFlags: if is_keyup {
                    KEYEVENTF_KEYUP
                } else {
                    Default::default()
                },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };

    unsafe {
        let _ = SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
    }
}

#[cfg(not(target_os = "windows"))]
fn send_key(_vk: u8, _is_keyup: bool) {}

#[cfg(target_os = "windows")]
fn send_mouse(button: u8, is_keyup: bool) {
    let flags;
    let mut mouse_data = 0;

    match button {
        1 => {
            flags = if is_keyup {
                MOUSEEVENTF_LEFTUP
            } else {
                MOUSEEVENTF_LEFTDOWN
            }
        }
        2 => {
            flags = if is_keyup {
                MOUSEEVENTF_RIGHTUP
            } else {
                MOUSEEVENTF_RIGHTDOWN
            }
        }
        3 => {
            flags = if is_keyup {
                MOUSEEVENTF_MIDDLEUP
            } else {
                MOUSEEVENTF_MIDDLEDOWN
            }
        }
        4 => {
            flags = if is_keyup {
                MOUSEEVENTF_XUP
            } else {
                MOUSEEVENTF_XDOWN
            };
            mouse_data = 1;
        }
        5 => {
            flags = if is_keyup {
                MOUSEEVENTF_XUP
            } else {
                MOUSEEVENTF_XDOWN
            };
            mouse_data = 2;
        }
        _ => return,
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
        let _ = SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
    }
}

#[cfg(not(target_os = "windows"))]
fn send_mouse(_button: u8, _is_keyup: bool) {}

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
            let _ = SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn type_string(_text: &str) {}

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
        let _ = SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
    }
}

#[cfg(not(target_os = "windows"))]
fn move_mouse(_dx: i32, _dy: i32) {}

#[cfg(target_os = "windows")]
fn scroll_mouse(delta: i32, horizontal: bool) {
    let input = INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx: 0,
                dy: 0,
                mouseData: delta as u32,
                dwFlags: if horizontal {
                    MOUSEEVENTF_HWHEEL
                } else {
                    MOUSEEVENTF_WHEEL
                },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    unsafe {
        let _ = SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
    }
}

#[cfg(not(target_os = "windows"))]
fn scroll_mouse(_delta: i32, _horizontal: bool) {}

#[cfg(target_os = "windows")]
fn move_mouse_absolute(x: i32, y: i32) {
    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};

    unsafe {
        let screen_width = GetSystemMetrics(SM_CXSCREEN);
        let screen_height = GetSystemMetrics(SM_CYSCREEN);
        let normalized_x = if screen_width > 0 {
            (x * 65535) / screen_width
        } else {
            0
        };
        let normalized_y = if screen_height > 0 {
            (y * 65535) / screen_height
        } else {
            0
        };

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
        let _ = SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
    }
}

#[cfg(not(target_os = "windows"))]
fn move_mouse_absolute(_x: i32, _y: i32) {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn macro_delay_does_not_block_immediate_queue() {
        let (observed_tx, observed_rx) = mpsc::channel::<String>();
        let executor: MacroExecutor = Arc::new(move |command| {
            if let SimulatorCommand::TypeString(text) = command {
                let _ = observed_tx.send(text);
            }
        });

        let sender = spawn_simulator_with_executor(executor);
        sender
            .send_macro(
                vec![
                    SimulatorCommand::Delay(250),
                    SimulatorCommand::TypeString("macro-finished".to_string()),
                ],
                MacroPlaybackConfig::default(),
                1,
            )
            .expect("macro queue should be available");

        std::thread::sleep(Duration::from_millis(25));
        sender
            .send(SimulatorCommand::TypeString("immediate".to_string()))
            .expect("immediate queue should be available");

        assert_eq!(
            observed_rx.recv_timeout(Duration::from_secs(1)).unwrap(),
            "immediate",
            "immediate command must execute while macro worker is delayed",
        );
        assert_eq!(
            observed_rx.recv_timeout(Duration::from_secs(1)).unwrap(),
            "macro-finished",
        );
    }

    #[test]
    fn macro_jobs_remain_serial_and_ordered() {
        let (observed_tx, observed_rx) = mpsc::channel::<String>();
        let executor: MacroExecutor = Arc::new(move |command| {
            if let SimulatorCommand::TypeString(text) = command {
                let _ = observed_tx.send(text);
            }
        });

        let sender = spawn_simulator_with_executor(executor);
        sender
            .send_macro(
                vec![
                    SimulatorCommand::TypeString("a".to_string()),
                    SimulatorCommand::TypeString("b".to_string()),
                ],
                MacroPlaybackConfig::default(),
                1,
            )
            .unwrap();
        sender
            .send_macro(
                vec![SimulatorCommand::TypeString("c".to_string())],
                MacroPlaybackConfig::default(),
                2,
            )
            .unwrap();

        let observed = (0..3)
            .map(|_| observed_rx.recv_timeout(Duration::from_secs(1)).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(observed, vec!["a", "b", "c"]);
    }
}
