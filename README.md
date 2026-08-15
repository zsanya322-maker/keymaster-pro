<!-- 🇬🇧 English | 🇷🇺 [Русский](README.ru.md) -->

<div align="center">

# ⌨️ KeyMaster Pro

**Keyboard and mouse remapping, macros, layers and text expansion for Windows**

[![License: FCL](https://img.shields.io/badge/License-FCL-blue.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D4.svg)](https://github.com/zsanya322-maker/keymaster-pro)
[![Current stable](https://img.shields.io/badge/stable-v0.2.4-2f855a.svg)](https://github.com/zsanya322-maker/keymaster-pro/releases/latest)
[![Built with Tauri](https://img.shields.io/badge/Tauri-v2-FFC131.svg)](https://v2.tauri.app)

[📥 Download](#download) · [✅ Current capabilities](#current-capabilities-v024) · [🗺️ Roadmap](ROADMAP.md) · [📝 Changelog](CHANGELOG.md) · [🐛 Issues](https://github.com/zsanya322-maker/keymaster-pro/issues)

</div>

---

## What is KeyMaster Pro?

KeyMaster Pro is a Windows desktop input-automation utility built around one rule model:

```text
TRIGGER + CONDITIONS -> ACTIONS
```

A rule can react to a keyboard key, supported mouse button, Tap-Hold gesture or typed text. Conditions can limit it to an active layer or foreground window. Actions can remap input, type text, run a recorded macro, control layers, manage windows/media/system actions, or launch/focus an application.

The application uses a **Rust daemon** for low-level Windows hooks and rule execution, with a **Tauri + React** GUI for editing profiles and rules. The GUI and daemon communicate through Named Pipes / JSON-RPC.

> **Documentation rule:** this README describes the current stable release only. Planned features and partially implemented ideas belong in [`ROADMAP.md`](ROADMAP.md).

---

## Current capabilities (v0.2.4)

### Triggers

- **Keyboard Key Down / Key Up** — one Windows virtual-key code per trigger.
- **Mouse Button Down / Up** — Left, Right, Middle, X1 and X2.
- **Tap-Hold** — one action set for tap and another for hold, with per-rule timeout.
- **Typed Text** — static abbreviation/sequence matching.

### Conditions

- **Layer Active**.
- **Window Match** by foreground process name and/or window-title substring.
  - When both fields are present in the current schema, matching uses **OR / ANY** semantics.

### Actions

- remap a keyboard key;
- remap a supported mouse button;
- type text;
- run a recorded keyboard/mouse macro;
- toggle or hold a layer;
- volume mute/up/down;
- media play/pause/next/previous/stop;
- window snap/minimize/maximize/close;
- launch an application;
- focus a process/window by process name or title;
- sleep the PC or turn the monitor off.

### Macros

- keyboard and mouse recording;
- mouse movement and scroll steps;
- per-step recorded delays;
- optional cursor-position restore after playback;
- macro playback runs on a separate worker/queue so a long macro `Delay` does **not** block ordinary immediate remaps.

### Layers and profiles

- create and use toggle/hold layers;
- add `Layer Active` conditions to rules;
- create, rename/save, delete, import, export and manually activate profiles;
- safe profile/config persistence with schema versioning, migration, backups, atomic writes and damaged-profile recovery.

### Desktop application

- compact classic-style Windows shell with inline rule editor;
- Russian and English UI;
- light/dark themes;
- system tray and Windows autostart;
- in-app signed updater through GitHub Releases;
- guarded unsaved-rule drafts during navigation, exit, restart and update;
- single-instance GUI and hardened daemon lifecycle/IPC.

---

## Important current limitations

The following items are **planned, not shipped as complete features in v0.2.4**:

- first-class modifier combinations such as `Ctrl + Shift + F2`;
- combination-to-combination remaps such as `Ctrl+Shift+F2 -> Alt+Tab`;
- complete friendly naming/picking for the practical Windows VK set;
- mouse wheel / horizontal wheel / double-click as rule triggers;
- macro speed, repeat count, repeat-while-held, cancel/emergency-stop and editor test playback;
- automatic app-based profile switching and manual-lock behavior;
- Virtual Desktop matching;
- date/time/clipboard variables, delimiters and undo in Text Expansion;
- folders/groups/tree organization for rules.

### Virtual Desktop compatibility note

`VirtualDesktop` still exists in the serialized schema so older/imported profiles can be read, but the runtime matcher is not implemented. The normal editor does not offer it as a new condition. Legacy Virtual Desktop conditions compile **fail-closed** rather than silently becoming global rules.

See [`ROADMAP.md`](ROADMAP.md) for the implementation order, data-model direction, migrations and acceptance criteria for these features.

---

## Architecture

```text
┌─────────────────────────────┐
│ GUI: Tauri + React/TypeScript│
│ rules, profiles, settings   │
└──────────────┬──────────────┘
               │ Named Pipes / JSON-RPC
┌──────────────▼──────────────┐
│ Rust daemon                 │
│ compiler + engine + context │
└───────────┬─────────┬───────┘
            │         │
       keyboard     mouse
       LL hook       LL hook
            │         │
       immediate   macro worker
       simulator   (isolated delays)
```

Key architectural guarantees carried forward from v0.2.4:

- one daemon owns the Named Pipe/input engines at a time;
- unsupported conditions must not fail open;
- low-level hooks stay free of slow file/network work;
- macro delays do not block the immediate-remap queue;
- profile/config migrations are non-destructive and reject unsupported future schemas.

---

## Download

### Installer (recommended)

Open [**GitHub Releases**](https://github.com/zsanya322-maker/keymaster-pro/releases/latest) and download:

```text
KeyMaster-Pro_<version>_x64-setup.exe
```

The installed application can then update itself through the built-in signed updater.

### MSI

An x64 MSI is also attached to public releases for users who prefer MSI deployment.

### WinGet

The repository contains a WinGet publishing workflow. If the package is available in your WinGet source, the package ID is:

```powershell
winget install KeyMasterPro.KeyMasterPro
```

### Portable build

A deliberate public portable ZIP is still planned. Dev/checkpoint standalone binaries are **not** treated as the stable portable distribution yet.

---

## Build from source

### Prerequisites

- Windows 10/11 x64;
- Node.js 22 recommended;
- pnpm 9+;
- current stable Rust toolchain (MSVC target);
- Visual Studio Build Tools with C++ build tools.

### Commands

```powershell
git clone https://github.com/zsanya322-maker/keymaster-pro.git
cd keymaster-pro
pnpm install
pnpm tauri dev
```

Production build:

```powershell
pnpm tauri build
```

The Windows bundles are generated under:

```text
src-tauri/target/release/bundle/
```

Repository validation used for release candidates includes:

```powershell
pnpm build
pnpm lint
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

---

## Technology stack

| Layer | Technology |
|---|---|
| Backend / desktop shell | Rust + Tauri v2 |
| Frontend | React 19 + TypeScript + Vite 6 |
| UI styling/icons | Tailwind CSS 4 + Lucide |
| State | Zustand |
| i18n | i18next (EN + RU) |
| Input hooks | `SetWindowsHookEx` (`WH_KEYBOARD_LL`, `WH_MOUSE_LL`) via windows-rs |
| Context tracking | foreground-window WinEvent hook |
| IPC | Named Pipes + JSON-RPC 2.0 |
| Storage | local JSON profile/config files |

---

## Privacy and input handling

KeyMaster Pro needs low-level keyboard and mouse hooks to remap input. That can look suspicious to security software because the same Windows APIs can also be used by keyloggers.

The project is designed to process input events in memory for matching/remapping. It does not intentionally persist a keystroke history. Profiles and settings are local JSON files; the built-in updater contacts GitHub Releases when checking/downloading updates.

Because low-level input interception and synthetic input are core functionality, antivirus false positives are possible. Review the source and release artifacts if that matters for your environment.

---

## Development roadmap

The next core-completion sequence is maintained in [`ROADMAP.md`](ROADMAP.md):

- **0.3.0** — modifier/key combinations, rule-model v2, full key picker, tree foundation;
- **0.3.1** — mouse trigger completion and macro playback/control;
- **0.3.2** — profiles/auto-switch/manual lock, richer context rules, Virtual Desktop;
- **0.3.3** — Text Expansion completion;
- **0.4.0** — Leader Keys, Sequences, ordinary-key Chords and Mouse Gestures.

Scripting, browser automation, plugins, cloud sync, AI and marketplace work are intentionally deferred until the core input model is complete and stable.

---

## Contributing / bugs

- Bugs: [GitHub Issues](https://github.com/zsanya322-maker/keymaster-pro/issues)
- Roadmap: [`ROADMAP.md`](ROADMAP.md)
- Shipped changes: [`CHANGELOG.md`](CHANGELOG.md)
- Telegram (RU): [@KeyM_Pro](https://t.me/KeyM_Pro)

When contributing a feature that changes rules or profiles, treat **schema + migration + compiler/runtime + UI + tests** as one unit. A UI control alone does not make a feature complete.

---

## License

KeyMaster Pro is licensed under the **Fair Core License (FCL)**. See [`LICENSE`](LICENSE) for the exact terms and conversion date.
