<!-- 🇬🇧 English | 🇷🇺 [Русский](README.ru.md) -->

<div align="center">

# ⌨️ KeyMaster Pro

**A modern keyboard & mouse automation utility for Windows**

[![License: FCL](https://img.shields.io/badge/License-FCL-blue.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D4.svg)](https://github.com/zsanya322-maker/keymaster-pro)
[![Built with Tauri](https://img.shields.io/badge/Built%20with-Tauri%20v2-FFC131.svg)](https://v2.tauri.app)
[![Rust](https://img.shields.io/badge/Rust-edition%202021-CE422B.svg)](https://www.rust-lang.org)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev)
[![winget](https://img.shields.io/badge/Install%20with-winget-0078D4.svg)](https://github.com/microsoft/winget-pkgs/pull/390087)

[📥 Download](#-download) · [✨ Features](#-features) · [🛠️ Build](#%EF%B8%8F-build-from-source) · [💬 Telegram (RU)](https://t.me/KeyM_Pro) · [🐛 Report Bug](https://github.com/zsanya322-maker/keymaster-pro/issues)

</div>

---

## 📝 Description

**KeyMaster Pro** is a powerful desktop application for Windows built around a single idea: **everything is a rule**. Instead of juggling separate screens for remapping, macros, layers, and text expansions, you build one rule at a time in a unified **Rule Builder**:

```
[ TRIGGER ]  +  [ CONDITIONS ]  →  [ ACTIONS ]
```

A key press, mouse click, typed abbreviation, or tap-hold fires a rule. Optional conditions (active window, active layer) decide whether it runs. Then one or more actions execute — remap a key, run a macro, snap a window, control media, and more.

Built with **Rust + Tauri v2 + React 19**, it runs at the OS level using `SetWindowsHookEx` to intercept and process input in real time, with **zero input logging** and a tiny memory footprint (~23 MB RAM, <1% CPU).

> Looking for a **free, source-available alternative** to AutoHotkey, PowerToys Keyboard Manager, or Key Manager? You found it.

---

## ⚖️ How it compares

KeyMaster Pro is the only Windows tool that combines a **unified rule system** (trigger → condition → action) with a no-code GUI — covering remapping, macros, layers, text expansion, window management, and per-app profiles in one place.

| Feature | KeyMaster Pro | PowerToys KBM | AutoHotkey | kanata | SharpKeys | Espanso |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Unified Rule Builder (no code) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Key remapping | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Mouse remapping | ✅ | ❌ | ✅ | ⚠️ | ❌ | ❌ |
| Macro recorder (key + mouse) | ✅ | ❌ | ✅ | ⚠️ | ❌ | ❌ |
| Text expansions | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ |
| Layers (toggle + hold, QMK-style) | ✅ | ❌ | ⚠️ | ✅ | ❌ | ❌ |
| Tap-Hold (home-row mods) | ✅ | ❌ | ⚠️ | ✅ | ❌ | ❌ |
| Per-app conditions (window match) | ✅ | ❌ | ⚠️ | ⚠️ | ❌ | ❌ |
| Window management (snap/min/max) | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Media keys & volume control | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Launch app / focus window | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| System actions (sleep, monitor off) | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Modern UI (Tauri/React) | ✅ | ✅ | ❌ | ❌ | ⚠️ | ⚠️ |
| Price | Free | Free | Free | Free | Free | Free → $4/mo |

> [!NOTE]
> PowerToys users have requested per-app remapping ([#6756](https://github.com/microsoft/PowerToys/issues/6756)), mouse remapping ([#1475](https://github.com/microsoft/PowerToys/issues/1475)), and text expansion ([#5074](https://github.com/microsoft/PowerToys/issues/5074)) for **years** — KeyMaster Pro ships with all three today, composable inside a single rule.

---

<!-- 📸 Screenshot will be added after the 0.2.0 release -->

## ✨ Features

Everything lives inside the **Rule Builder** — a single modal where you compose a rule from three parts. No more flipping between disconnected screens.

### 🎯 Triggers (what fires a rule)
- **Key Down / Key Up** — any keyboard key or shortcut
- **Mouse Down / Mouse Up** — left, right, middle, X1, X2 buttons
- **Tap-Hold** — tap for one action, hold for another (home-row mods, kanata-style)
- **Typed Text** — type an abbreviation to fire an expansion

### ⚡ Actions (what happens when a rule fires)
| Category | Actions |
|---|---|
| **Remap** | Remap Key, Remap Mouse Button |
| **Input** | Type Text, Run Macro (recorded key + mouse steps with delays) |
| **Layers** | Toggle Layer, Hold Layer (while key is held) |
| **System** | Volume (mute / up / down), Media Key (play / next / prev / stop), Sleep, Monitor Off |
| **Windows** | Snap left / right / center, Minimize, Maximize, Close, Focus Process Window |
| **Launch** | Launch Application |

### 🧩 Conditions (optional — when a rule should apply)
- **Layer Active** — rule only fires while a specific layer is on
- **Window Match** — rule only fires when the active window matches a process name and/or window title
- **Virtual Desktop** — rule scoped to a specific virtual desktop

### 🔄 Per-App Profiles
Group rules into **profiles** that auto-switch based on the focused application's window. Different rules for your editor, browser, and games — automatically.

### 🔥 Layers (QMK-style)
Toggle or hold a layer to completely change what your keys do — the same keycap can do different things in different layers. Layers are first-class citizens: toggle them from any rule or hold a key to keep a layer active only while pressed.

### 🚀 Two-Process Architecture
A lightweight background **daemon** (Rust) handles the low-level input hooks and rule execution, while the **GUI** (React) stays responsive. Kill the UI and your remaps keep working.

### Plus
| Feature | Description |
|---------|-------------|
| 🧙 **Onboarding Wizard** | Built-in starter examples for new users — get a working remap in seconds |
| 📊 **Real-time Stats** | CPU, RAM, latency, and keystroke counter in the status bar |
| 🔔 **Auto-updates** | Update in-app via Tauri updater (or `winget upgrade`) |
| 🌐 **Multilingual** | English and Russian interface (i18next) |
| 🎨 **Modern UI** | Radix UI + TailwindCSS + Lucide icons, dark/light theme |
| 📝 **Per-session Logs** | Debug logs for diagnosing rule behavior |
| 🛡️ **System Tray** | Minimize to tray, autostart with Windows |

---

## 📥 Download

### Option A: WinGet (recommended)

Install KeyMaster Pro with a single command on Windows 10/11:

```bash
winget install KeyMasterPro.KeyMasterPro
```

- Automatically updates with `winget upgrade KeyMasterPro.KeyMasterPro`
- No manual download needed — WinGet handles everything

> Requires [WinGet](https://github.com/microsoft/winget-cli) (pre-installed on Windows 10 1709+ and Windows 11).

### Option B: Installer

➡️ Go to [**Releases**](https://github.com/zsanya322-maker/keymaster-pro/releases) and download `KeyMaster-Pro_x.x.x_x64-setup.exe`

- No dependencies required — just download and run
- WebView2 Runtime is pre-installed on Windows 10/11 (auto-downloaded if missing)
- The installer supports **auto-updates** via GitHub

### Option C: Portable

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
| ✅ Done | Unified Rules Engine & Rule Builder, key/mouse remapping, macros, layers (toggle/hold), tap-hold, text expansions, per-app profiles, window management, media keys & volume, system actions, onboarding wizard, system tray, autostart, dark/light theme, auto-updates, per-session logs, winget distribution |
| 🔄 Next | Portable .zip build, code signing certificate, settings UI polish |
| 📋 Planned | Rhai scripting engine, browser extension, plugin system |

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
