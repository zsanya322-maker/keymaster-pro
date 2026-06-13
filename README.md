<!-- 🇬🇧 English | 🇷🇺 [Русский](README.ru.md) -->

<div align="center">

# ⌨️ KeyMaster Pro

**A modern keyboard automation & remapping utility for Windows**

[![License: FCL](https://img.shields.io/badge/License-FCL-blue.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D4.svg)](https://github.com/USERNAME/keymaster-pro)
[![Built with Tauri](https://img.shields.io/badge/Built%20with-Tauri%20v2-FFC131.svg)](https://v2.tauri.app)
[![Rust](https://img.shields.io/badge/Rust-edition%202021-CE422B.svg)](https://www.rust-lang.org)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev)

[📥 Download](#-download) · [✨ Features](#-features) · [🛠️ Build](#%EF%B8%8F-build-from-source) · [🛡️ Security](#%EF%B8%8F-security--false-positives) · [💬 Community](#-community)

</div>

---

## 📝 Description

**KeyMaster Pro** is a powerful desktop application for Windows that lets you remap keys, record macros, create text expansions, and automate repetitive tasks — all through a clean, modern interface.

Built with **Rust + Tauri v2 + React 19**, it runs at the OS level using `SetWindowsHookEx` to intercept and remap input in real time, with **zero input logging** and a tiny memory footprint (~23 MB RAM, <1% CPU).

> Looking for a **free, open-source alternative** to AutoHotkey, PowerToys Keyboard Manager, or Key Manager? You found it.

---

## 📸 Screenshot

<div align="center">

![KeyMaster Pro Interface](.github/assets/screenshot.png)

</div>

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🎹 **Key Remapping** | Remap any key or shortcut to another key, action, or program launch |
| 🖱️ **Mouse Remapping** | Rebind mouse buttons and wheel actions |
| 🔥 **Layers** | Context-aware remapping — like QMK layers for your keyboard |
| ⚡ **Macro Recorder** | Record key presses and mouse clicks with delays, replay them anytime |
| 📝 **Text Expansions** | Type abbreviations that expand into full text snippets |
| 🔄 **Per-App Profiles** | Automatic profile switching based on the active window |
| 🚀 **Daemon Architecture** | Lightweight background daemon + GUI (two-process design) |
| 📊 **Real-time Stats** | CPU, RAM, latency, and keystroke counter in the status bar |
| 🎨 **Modern UI** | Clean interface with Radix UI + TailwindCSS |
| 🌐 **Multilingual** | English and Russian interface (i18next) |

---

## 📥 Download

### Option A: Installer (recommended for most users)

➡️ Go to [**Releases**](https://github.com/USERNAME/keymaster-pro/releases) and download `KeyMaster-Pro-Setup-x.x.x.exe`

- No dependencies required — just download and run
- WebView2 Runtime is pre-installed on Windows 10/11 (auto-downloaded if missing)
- The installer supports **auto-updates** via GitHub

### Option B: Portable

Soon — a portable `.zip` version is planned for a future release.

---

## 🛠️ Build from Source

### Prerequisites

1. **Node.js** 18+ and **pnpm** (`npm i -g pnpm`)
2. **Rust** 1.70+ ([rustup.rs](https://rustup.rs))
3. **Visual Studio Build Tools** — workload: `Microsoft.VisualStudio.Workload.VCTools`
   - Download: https://visualstudio.microsoft.com/visual-cpp-build-tools/

### Steps

```bash
# Clone
git clone https://github.com/USERNAME/keymaster-pro.git
cd keymaster-pro

# Install frontend dependencies
pnpm install

# Run in dev mode
pnpm tauri dev

# Build production binary (.exe)
pnpm tauri build
```

The built installer will appear in `src-tauri/target/release/bundle/nsis/`.

---

## 🏗️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Rust + Tauri v2 |
| **Frontend** | React 19 + TypeScript 5 + Vite 6 |
| **UI** | Radix UI + TailwindCSS 4 + Lucide Icons |
| **State** | Zustand 5 |
| **i18n** | i18next (EN + RU) |
| **Input Hooks** | SetWindowsHookEx (`WH_KEYBOARD_LL`, `WH_MOUSE_LL`) via windows-rs |
| **IPC** | Named Pipes + JSON-RPC 2.0 |
| **Storage** | Local JSON files (`%APPDATA%\KeyMaster Pro\`) |

---

## 🛡️ Security & False Positives

Since KeyMaster Pro uses low-level Win32 APIs to intercept and remap input (`SetWindowsHookEx`), some antivirus software may flag it as a potential keylogger or input injection tool. **This is a false positive.**

**Our security commitments:**

1. **No input logging** — The app **does not save, record, or transmit** your keystrokes. All processing happens in real time, in memory.
2. **Offline-first** — All configurations are stored locally as JSON in `%APPDATA%`. No cloud, no telemetry.
3. **No hidden network activity** — The only network request is checking for updates via HTTPS to GitHub.

*If Windows Defender or your antivirus blocks the app, add `KeyMasterPro.exe` to the exclusions list.*

---

## 🗺️ Roadmap

| Status | Feature |
|--------|---------|
| ✅ Done | Key/mouse remapping, macro recorder, layers, text expansions, profiles, system tray, auto-start with Windows, dark theme, minimize-to-tray |
| 🔄 Next | Portable .zip build, code signing certificate, settings UI polish |
| 📋 Planned | Rhai scripting engine, browser extension, plugin system, winget distribution |

---

## 🤝 Contributing

Contributions are welcome! Here's how you can help:

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit: `git commit -m 'Add amazing feature'`
4. Push: `git push origin feature/amazing-feature`
5. Open a Pull Request

Found a bug? [Open an issue](https://github.com/USERNAME/keymaster-pro/issues).

---

## 💬 Community

- 📱 **Telegram:** [@KeyM_Pro](https://t.me/KeyM_Pro)
- 🐛 **Bug reports:** [GitHub Issues](https://github.com/USERNAME/keymaster-pro/issues)
- 💬 **Discussions:** [GitHub Discussions](https://github.com/USERNAME/keymaster-pro/discussions)

---

## 📜 License

This project is licensed under the **Fair Core License (FCL)** — the source code is open, but protected from competitive use. See [LICENSE](LICENSE) for details.

On January 1, 2030, the license automatically converts to MIT.

---

<div align="center">

<sub>Built with ❤️ using Rust, Tauri, and React</sub>

<sub>

**Keywords:** keyboard remapping Windows, key rebinding tool, AutoHotkey alternative, PowerToys alternative, macro recorder, text expansion, input automation, Tauri desktop app, Rust Windows utility, keyboard macro, mouse remapping, key mapping software

</sub>

</div>