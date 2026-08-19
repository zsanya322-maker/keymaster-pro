// Предотвращаем создание консольного окна на Windows
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use clap::{Arg, Command};

fn main() {
    let matches = Command::new("KeyMaster Pro")
        .version(env!("CARGO_PKG_VERSION"))
        .about("Мощная утилита для перехвата клавиатуры и мыши")
        .arg(
            Arg::new("daemon")
                .long("daemon")
                .help("Запустить как daemon (background process без GUI)")
                .action(clap::ArgAction::SetTrue),
        )
        .arg(
            Arg::new("mcp")
                .long("mcp")
                .help("Запустить MCP stdio bridge в безопасном read-only режиме")
                .conflicts_with("daemon")
                .action(clap::ArgAction::SetTrue),
        )
        .arg(
            Arg::new("mcp-write")
                .long("mcp-write")
                .help("Запустить MCP stdio bridge с write/execute tools (явный opt-in)")
                .conflicts_with("daemon")
                .action(clap::ArgAction::SetTrue),
        )
        .arg(
            Arg::new("parent-pid")
                .long("parent-pid")
                .help("PID родительского процесса для мониторинга")
                .value_parser(clap::value_parser!(u32)),
        )
        .arg(
            Arg::new("gui-delay-ms")
                .long("gui-delay-ms")
                .hide(true)
                .help("Internal: delay GUI/Tauri initialization during process handoff")
                .value_parser(clap::value_parser!(u64)),
        )
        .get_matches();

    let mcp_write = matches.get_flag("mcp-write");
    if matches.get_flag("mcp") || mcp_write {
        if let Err(error) = keymaster_pro_lib::mcp::run_stdio(mcp_write) {
            eprintln!("MCP bridge error: {error}");
            std::process::exit(1);
        }
        return;
    }

    if matches.get_flag("daemon") {
        let parent_pid = matches.get_one::<u32>("parent-pid").copied();
        // Daemon-процесс (без Tauri/GUI)
        if let Err(e) = keymaster_pro_lib::daemon::runner::run_daemon(parent_pid) {
            eprintln!("Daemon error: {}", e);
            std::process::exit(1);
        }
    } else {
        // При Restart as Admin elevated-процесс создаётся до завершения старого
        // GUI. Небольшая задержка ДО Tauri/single-instance даёт старому процессу
        // освободить single-instance lock и исключает ложное закрытие новой копии.
        if let Some(delay_ms) = matches.get_one::<u64>("gui-delay-ms").copied() {
            std::thread::sleep(std::time::Duration::from_millis(delay_ms.min(5_000)));
        }

        // GUI-процесс (Tauri)
        keymaster_pro_lib::run();
    }
}
