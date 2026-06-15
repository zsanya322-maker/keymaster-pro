<!-- 🇬🇧 English | 🇷🇺 [Русский](README.ru.md) -->

<div align="center">

# ⌨️ KeyMaster Pro

**A modern keyboard automation & remapping utility for Windows**

[![License: FCL](https://img.shields.io/badge/License-FCL-blue.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D4.svg)](https://github.com/zsanya322-maker/keymaster-pro)
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

## ⚖️ How it compares

KeyMaster Pro is the only Windows tool that combines **GUI-driven** key remapping, mouse remapping, macros, layers, text expansion, and per-app profiles in a single app.

| Feature | KeyMaster Pro | PowerToys KBM | AutoHotkey | kanata | SharpKeys | Espanso |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| GUI (no code) | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ |
| Key remapping | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Mouse remapping | ✅ | ❌ | ✅ | ⚠️ | ❌ | ❌ |
| Macro recorder | ✅ | ❌ | ✅ | ⚠️ | ❌ | ❌ |
| Text expansions | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ |
| Layers (QMK-style) | ✅ | ❌ | ⚠️ | ✅ | ❌ | ❌ |
| Per-app profiles | ✅ | ❌ | ⚠️ | ⚠️ | ❌ | ❌ |
| Modern UI (Tauri/React) | ✅ | ✅ | ❌ | ❌ | ⚠️ | ⚠️ |
| Price | Free | Free | Free | Free | Free | Free → $4/mo |

> [!NOTE]
> PowerToys users have requested per-app remapping ([#6756](https://github.com/microsoft/PowerToys/issues/6756)), mouse remapping ([#1475](https://github.com/microsoft/PowerToys/issues/1475)), and text expansion ([#5074](https://github.com/microsoft/PowerToys/issues/5074)) for **years** — KeyMaster Pro ships with all three today.

---

## 📸 Screenshot

<div align="center">

![KeyMaster Pro Interface](.github/assets/screenshot.png)

</div>

---

## ✨ Features

### 🎹 Key Remapping
<!-- TODO: record a 5-10s gif showing a key remap in action and save to .github/assets/remap.gif -->
![Key Remapping](.github/assets/remap.gif)

Remap any key or shortcut to another key, action, or program launch.

### 🖱️ Mouse Remapping
<!-- TODO: record a 5-10s gif showing a mouse button remap and save to .github/assets/mouse.gif -->
![Mouse Remapping](.github/assets/mouse.gif)

Rebind mouse buttons and wheel actions — a feature PowerToys users have [requested for 6 years](https://github.com/microsoft/PowerToys/issues/1475).

### 🔥 Layers
<!-- TODO: record a 5-10s gif showing a layer toggle changing key behavior and save to .github/assets/layers.gif -->
![Layers](.github/assets/layers.gif)

Context-aware remapping — like QMK layers for your keyboard.

### ⚡ Macro Recorder
<!-- TODO: record a 5-10s gif recording and replaying a macro and save to .github/assets/macro.gif -->
![Macro Recorder](.github/assets/macro.gif)

Record key presses and mouse clicks with delays, replay them anytime.

### 📝 Text Expansions
<!-- TODO: record a 5-10s gif typing an abbreviation that expands and save to .github/assets/text-expansion.gif -->
![Text Expansions](.github/assets/text-expansion.gif)

Type abbreviations that expand into full text snippets — a free alternative to TextExpander ($4/mo).

### 🔄 Per-App Profiles
<!-- TODO: record a 5-10s gif switching apps and showing the profile auto-switch and save to .github/assets/profiles.gif -->
![Per-App Profiles](.github/assets/profiles.gif)

Automatic profile switching based on the active window.

### Plus
| Feature | Description |
|---------|-------------|
| 🚀 **Daemon Architecture** | Lightweight background daemon + GUI (two-process design) |
| 📊 **Real-time Stats** | CPU, RAM, latency, and keystroke counter in the status bar |
| 🎨 **Modern UI** | Clean interface with Radix UI + TailwindCSS |
| 🌐 **Multilingual** | English and Russian interface (i18next) |

---

## 📥 Download

### Option A: Installer (recommended for most users)

➡️ Go to [**Releases**](https://github.com/zsanya322-maker/keymaster-pro/releases) and download `KeyMaster-Pro-Setup-x.x.x.exe`

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
git clone https://github.com/zsanya322-maker/keymaster-pro.git
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

Found a bug? [Open an issue](https://github.com/zsanya322-maker/keymaster-pro/issues).

---

## 💬 Community

- 📱 **Telegram:** [@KeyM_Pro](https://t.me/KeyM_Pro)
- 🐛 **Bug reports:** [GitHub Issues](https://github.com/zsanya322-maker/keymaster-pro/issues)
- 💬 **Discussions:** [GitHub Discussions](https://github.com/zsanya322-maker/keymaster-pro/discussions)

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
