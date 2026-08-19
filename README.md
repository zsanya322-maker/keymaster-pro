<!-- 🇬🇧 English | 🇷🇺 [Русский](README.ru.md) -->

<div align="center">

# ⌨️ KeyMaster Pro

**Keyboard and mouse remapping, macros, layers and text expansion for Windows**

[![License: FCL](https://img.shields.io/badge/License-FCL-blue.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D4.svg)](https://github.com/zsanya322-maker/keymaster-pro)
[![Current stable](https://img.shields.io/badge/stable-v0.4.1-2f855a.svg)](https://github.com/zsanya322-maker/keymaster-pro/releases/latest)
[![Built with Tauri](https://img.shields.io/badge/Tauri-v2-FFC131.svg)](https://v2.tauri.app)

[📥 Download](#download) · [✅ Current capabilities](#current-capabilities-v041) · [🗺️ Roadmap](ROADMAP.md) · [📝 Changelog](CHANGELOG.md) · [🐛 Issues](https://github.com/zsanya322-maker/keymaster-pro/issues)

</div>

---

## What is KeyMaster Pro?

KeyMaster Pro is a Windows desktop input-automation utility built around one rule model:

```text
TRIGGER + CONDITIONS -> ACTIONS
```

The application uses a **Rust daemon** for low-level Windows hooks, input-state machines, context tracking and rule execution, with a **Tauri + React** GUI for profiles, rules, macro editing and settings. GUI and daemon communicate through Named Pipes / JSON-RPC.

> **Documentation rule:** this README describes the current stable release. Shipped history belongs in [`CHANGELOG.md`](CHANGELOG.md); remaining work belongs in [`ROADMAP.md`](ROADMAP.md).

---

## Current capabilities (v0.4.1)

### Keyboard and mouse triggers

- **Key Down / Key Up** with first-class modifier combinations (`Ctrl`, `Alt`, `Shift`, `Win`) through a reusable key-chord model.
- Combination-to-combination key remapping with deterministic modifier handling.
- Expanded Windows VK catalogue and compact chord-aware key picker.
- Mouse button Down / Up for Left, Right, Middle, X1 and X2.
- Mouse wheel and horizontal wheel directions.
- Mouse double-click triggers.
- Mouse movement triggers with distance/cooldown configuration.
- Tap-Hold key triggers.
- **Leader sequences**.
- Ordinary **key sequences**.
- Simultaneous ordinary-key **chord sets**.
- **Mouse gestures** with directional paths.

### Conditions and context

- active-layer conditions;
- legacy process/title window matching;
- structured `contextMatch` rules with explicit **ANY / ALL** mode;
- process name and executable path;
- window title and class;
- window size ranges;
- fullscreen state;
- monitor and virtual-desktop identifiers when available from the normalized Windows context snapshot.

### Actions

- remap keyboard chords;
- remap supported mouse buttons;
- type text and render text templates;
- run a named macro from the profile macro library;
- toggle or hold a layer;
- volume mute/up/down;
- media play/pause/next/previous/stop;
- window snap/minimize/maximize/close;
- launch an application;
- focus a process/window;
- sleep the PC or turn the monitor off.

### Macro library and playback

v0.4.1 promotes macros to first-class profile objects instead of embedding independent step lists directly inside rules.

- named per-profile macro library;
- create, edit, duplicate, search and delete macros;
- usage count and deletion guard while a macro is referenced by rules;
- rules reference macros by `macroId`;
- keyboard and mouse recording;
- mouse movement, vertical/horizontal scrolling and absolute-position steps;
- editable per-step delays and drag/reorder workflow;
- playback speed multiplier;
- repeat count and repeat-while-held;
- preview/test playback from the editor;
- stop/cancel playback and configurable emergency-stop key;
- separate macro worker/queue, so macro delays do not block ordinary immediate remaps;
- schema-v7 migration converts older inline macro actions into library objects without sharing unrelated legacy macros accidentally.

### Text Expansion

- instant and delimiter-based expansion modes;
- configurable delimiters and case sensitivity;
- `{{date}}`, `{{time}}` and `{{clipboard}}` template tokens;
- selectable date/time formats;
- clipboard access only when a fired template actually requests it;
- `Ctrl+Z` undo for the most recent eligible expansion;
- bounded, memory-only typed-text state with focus/timeout reset; no persistent keystroke history.

### Profiles, bindings and rule organization

- create, rename, duplicate, reorder, save, delete, import, export and manually activate profiles;
- structured application/context bindings;
- automatic profile switching;
- global Auto-switch ON/OFF;
- Manual Profile Lock so explicit user selection can override automatic switching;
- nested rule folders with stable IDs/order;
- rule enable/disable, folder assignment, ordering and priority;
- layers with toggle/hold actions and layer-active conditions;
- schema-aware, non-destructive profile/config migrations with backups, atomic writes and damaged-profile recovery.

### Desktop application

- compact classic-style Windows shell;
- simplified rule editor built around **WHEN / IF / DO** blocks;
- searchable compact type pickers for triggers, conditions and actions;
- separate Macro Library workspace;
- Russian and English UI;
- light/dark themes;
- system tray and Windows autostart;
- signed in-app updater through GitHub Releases;
- guarded unsaved drafts during navigation, exit, restart and update;
- single-instance GUI and hardened daemon lifecycle/IPC.

---

## Important current limitations

The following are intentionally **not** claimed as complete in v0.4.1:

- reliable secure/password-field detection for Text Expansion across arbitrary applications and browsers;
- a dedicated public portable ZIP release asset;
- user-facing backup/restore tooling beyond the internal persistence safeguards;
- a separate explicit layer-priority model beyond rule priority/order;
- scripting/plugin APIs, browser automation, cloud sync, AI features and a marketplace.

See [`ROADMAP.md`](ROADMAP.md) for the remaining work after the completed 0.3.x → 0.4.1 core cycle.

---

## Preview in PR #4: Automation Lab (0.5.0 candidate)

This branch adds the first production-hardened vertical slice for **AI Composer**, the local **MCP bridge**, and portable **keymaster-pack v1** bundles. It intentionally remains a draft until the Windows UI is manually exercised on the branch.

### AI Automation Composer

- OpenAI-compatible provider endpoint with a typed draft contract and explicit preview/install flow.
- The API key exists only in request/UI state: KeyMaster does **not** save it to the profile, config, store, or logs.
- Plain `http://` is accepted only for localhost providers; remote providers must use TLS (`https://`).
- Provider/network failures cross the Rust boundary as stable error codes and are rendered by the selected UI locale.
- Generated rules/macros are re-deserialized and validated by the Rust daemon against runtime profile types before any profile write.
- Every install creates a profile backup and a one-click **Undo install** receipt; stale Undo is blocked after a newer profile mutation.

### MCP bridge

KeyMaster exposes a local stdio MCP server through the installed executable:

- `KeyMaster-Pro.exe --mcp` — read-only profile/status reads plus rule validation.
- `KeyMaster-Pro.exe --mcp-write` — explicit opt-in for profile activation, macro execution and rule writes.

Claude Desktop / Claude Code local stdio example (use `--mcp` by default):

```json
{
  "mcpServers": {
    "keymaster": {
      "command": "C:\\Program Files\\KeyMaster-Pro\\KeyMaster-Pro.exe",
      "args": ["--mcp"]
    }
  }
}
```

For Claude Code the same object can live in project `.mcp.json` or be supplied through its MCP configuration options. Change the argument to `--mcp-write` only when write/execute access is deliberately required.

**ChatGPT scope:** this PR does not expose the local stdio process as a ChatGPT app/connector. OpenAI MCP integrations use a reachable **remote MCP server URL/service connector**, so remote HTTP transport, authentication, exposure and threat review are a separate task.

### `keymaster-pack` v1

- portable JSON envelope: `format: "keymaster-pack"`, `version: 1`;
- import limit: **2 MiB**, checked before and after file read/parsing;
- local inspection reports permissions and high-risk actions before install;
- imported macro/layer/folder/rule UUIDs are regenerated and internal references are rebound;
- dangling references, duplicate IDs, folder cycles, empty actions and malformed payloads are rejected;
- final acceptance is the same Rust automation validation/write boundary used by AI and MCP;
- install is backup-first and Undo-capable.

### Validation evidence

PR #4 Windows CI runs frontend unit tests, TypeScript/Vite, Rust check/tests and ESLint, then a separate real-process MCP smoke test. The smoke job builds `KeyMaster-Pro.exe`, launches a real daemon with isolated `%APPDATA%`, connects with the official `@modelcontextprotocol/client`, exercises both MCP modes, verifies all seven write-mode tools, disk persistence, physical backup, Undo/stale-Undo protection, and concurrent profile mutations.

**Not in this PR:** the second Hub layer (diff/conflict detector, signed catalog), marketplace/discovery, and remote MCP hosting for ChatGPT. Those remain separate work after this vertical slice passes manual Windows UI QA.

---

## Architecture

```text
┌──────────────────────────────────┐
│ GUI: Tauri + React/TypeScript    │
│ rules, macros, profiles, settings│
└────────────────┬─────────────────┘
                 │ Named Pipes / JSON-RPC
┌────────────────▼─────────────────┐
│ Rust daemon                     │
│ compiler + engine + input state │
│ context tracker + macro runtime │
└────────────┬───────────┬─────────┘
             │           │
        keyboard       mouse
        LL hook        LL hook
             │           │
        immediate     macro worker
        simulator     / state machines
```

Core guarantees carried into v0.4.1:

- one daemon owns the Named Pipe/input engines at a time;
- unsupported conditions must not silently fail open;
- low-level hooks stay free of slow file/network work;
- bounded state machines handle advanced input patterns outside ad-hoc sleeps;
- macro delays do not block the immediate-remap queue;
- migrations are backward compatible and non-destructive, and unsupported future schemas are rejected.

---

## Download

### Installer (recommended)

Open [**GitHub Releases**](https://github.com/zsanya322-maker/keymaster-pro/releases/latest) and download the Windows installer for the latest release.

The installed application can update itself through the built-in signed updater.

### MSI

An x64 MSI can also be produced by the release workflow for deployment scenarios that prefer MSI.

### WinGet

The repository contains a WinGet publishing workflow. The package ID used by the project is:

```powershell
winget install KeyMasterPro.KeyMasterPro
```

### Portable build

A deliberate public portable ZIP remains planned. Dev/checkpoint standalone binaries are not treated as the stable portable distribution.

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

Windows bundles are generated under:

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
| Context tracking | foreground-window WinEvent/Windows context APIs |
| IPC | Named Pipes + JSON-RPC 2.0 |
| Storage | local JSON profile/config files |

---

## Privacy and input handling

KeyMaster Pro needs low-level keyboard and mouse hooks to remap input. Those APIs can also be used by keyloggers, so security software may treat this class of utility cautiously.

The project processes input events in memory for matching/remapping and does not intentionally persist a keystroke history. Text Expansion keeps only a bounded in-memory buffer. Profiles and settings are local JSON files; the built-in updater contacts GitHub Releases when checking/downloading updates.

---

## Development roadmap

The original core-completion sequence is now complete:

- **0.3.0** — modifier/key combinations, expanded key model and nested rule-tree foundation;
- **0.3.1** — mouse trigger completion and macro playback/control;
- **0.3.2** — profiles, auto-switch/manual lock and richer context matching;
- **0.3.3** — Text Expansion templates, delimiter modes and undo;
- **0.4.0** — Leader Keys, Sequences, ordinary-key Chords and Mouse Gestures;
- **0.4.1** — simplified rule UX, first-class Macro Library and schema v7.

Future work is tracked in [`ROADMAP.md`](ROADMAP.md) without pretending completed milestones are still planned.

---

## Contributing / bugs

- Bugs: [GitHub Issues](https://github.com/zsanya322-maker/keymaster-pro/issues)
- Roadmap: [`ROADMAP.md`](ROADMAP.md)
- Shipped changes: [`CHANGELOG.md`](CHANGELOG.md)
- Telegram (RU): [@KeyM_Pro](https://t.me/KeyM_Pro)

When a feature changes rules or profiles, treat **schema + migration + compiler/runtime + UI + tests** as one unit. A UI control alone does not make a feature complete.

---

## License

KeyMaster Pro is licensed under the **Fair Core License (FCL)**. See [`LICENSE`](LICENSE) for the exact terms and conversion date.
