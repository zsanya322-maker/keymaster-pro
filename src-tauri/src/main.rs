// Предотвращаем создание консольного окна на Windows
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use clap::{Command, Arg};

fn main() {
    let matches = Command::new("KeyMaster Pro")
        .version(env!("CARGO_PKG_VERSION"))
        .about("Мощная утилита для перехвата клавиатуры и мыши")
        .arg(
            Arg::new("daemon")
                .long("daemon")
                .help("Запустить как daemon (background process без GUI)")
                .action(clap::ArgAction::SetTrue)
        )
        .arg(
            Arg::new("parent-pid")
                .long("parent-pid")
                .help("PID родительского процесса для мониторинга")
                .value_parser(clap::value_parser!(u32))
        )
        .get_matches();

    if matches.get_flag("daemon") {
        let parent_pid = matches.get_one::<u32>("parent-pid").copied();
        // Daemon-процесс (без Tauri/GUI)
        if let Err(e) = keymaster_pro_lib::daemon::runner::run_daemon(parent_pid) {
            eprintln!("Daemon error: {}", e);
            std::process::exit(1);
        }
    } else {
        // GUI-процесс (Tauri)
        keymaster_pro_lib::run();
    }
}