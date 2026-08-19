<!-- 🇬🇧 English | 🇷🇺 [Русский](README.ru.md) -->

<div align="center">

# ⌨️ KeyMaster Pro

**Keyboard and mouse remapping, macros, layers, text expansion and AI-assisted automation for Windows**

[![License: FCL](https://img.shields.io/badge/License-FCL-blue.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D4.svg)](https://github.com/zsanya322-maker/keymaster-pro)
[![Current stable](https://img.shields.io/badge/stable-v0.5.1-2f855a.svg)](https://github.com/zsanya322-maker/keymaster-pro/releases/latest)
[![Built with Tauri](https://img.shields.io/badge/Tauri-v2-FFC131.svg)](https://v2.tauri.app)

[📥 Download](#download) · [✅ Current capabilities](#current-capabilities-v051) · [🤖 Automation Lab](#automation-lab) · [🗺️ Roadmap](ROADMAP.md) · [📝 Changelog](CHANGELOG.md) · [🐛 Issues](https://github.com/zsanya322-maker/keymaster-pro/issues)

</div>

---

## What is KeyMaster Pro?

KeyMaster Pro is a Windows desktop input-automation utility built around one rule model:

```text
TRIGGER + CONDITIONS -> ACTIONS
```

The application uses a **Rust daemon** for low-level Windows hooks, input-state machines, context tracking, macro execution and profile writes. The desktop GUI is built with **Tauri + React/TypeScript**. GUI and daemon communicate through Named Pipes / JSON-RPC.

> **Documentation rule:** this README describes the current stable release. Shipped history belongs in [`CHANGELOG.md`](CHANGELOG.md); remaining work belongs in [`ROADMAP.md`](ROADMAP.md).

---

## Current capabilities (v0.5.1)

### Keyboard and mouse

- Key Down / Key Up triggers with `Ctrl`, `Alt`, `Shift`, `Win` modifier combinations.
- Combination-to-combination key remapping.
- Expanded Windows VK catalogue and chord-aware key picker.
- Left / Right / Middle / X1 / X2 mouse buttons.
- Vertical and horizontal wheel triggers.
- Double-click and mouse-movement triggers.
- Tap-Hold.
- Leader sequences.
- Ordinary key sequences.
- Simultaneous ordinary-key chord sets.
- Directional mouse gestures.

### Conditions and context

- active-layer conditions;
- process/title matching;
- structured `contextMatch` with explicit ANY / ALL semantics;
- process name and executable path;
- window title and class;
- window size ranges;
- fullscreen state;
- monitor and virtual-desktop identifiers when available from the normalized Windows context snapshot.

### Actions

- remap keyboard chords and supported mouse buttons;
- type text and render text templates;
- run named macros;
- toggle or hold layers;
- system volume and media controls;
- snap/minimize/maximize/close windows;
- launch applications;
- focus a process/window;
- sleep the PC or turn the monitor off.

### Macro Library

Macros are first-class per-profile objects and rules reference them through `macroId`.

- create, edit, duplicate, search and delete macros;
- usage count and guarded deletion while referenced;
- keyboard and mouse recording;
- mouse movement, vertical/horizontal scrolling and absolute-position steps;
- editable delays and step reordering;
- playback speed, repeat count and repeat-while-held;
- preview/test playback;
- stop/cancel and configurable emergency-stop key;
- separate macro worker/queue so macro delays do not block ordinary immediate remaps.

### Text Expansion

- instant and delimiter modes;
- configurable delimiters and case sensitivity;
- `{{date}}`, `{{time}}` and `{{clipboard}}` templates;
- date/time format selection;
- lazy clipboard reads only when a fired template requests `{{clipboard}}`;
- `Ctrl+Z` undo for the most recent eligible expansion;
- bounded in-memory typed-text state with focus/timeout reset; no persistent keystroke history.

### Profiles, rules and layers

- create, rename, duplicate, reorder, save, delete, import, export and activate profiles;
- structured application/context bindings;
- automatic profile switching;
- global Auto-switch ON/OFF and Manual Profile Lock;
- nested rule folders with stable IDs/order;
- rule enable/disable, folder assignment, ordering and priority;
- layers with toggle/hold actions and layer-active conditions;
- schema-aware migrations, backups, atomic writes and damaged-profile recovery.

### Desktop application

- compact classic-style Windows shell;
- rule editor built around **WHEN / IF / DO** blocks;
- searchable compact trigger/action/condition pickers;
- separate Macro Library workspace;
- Russian and English UI;
- light/dark themes;
- system tray and Windows autostart;
- signed in-app updater through GitHub Releases;
- guarded unsaved drafts during navigation, exit, restart and update;
- single-instance GUI and hardened daemon lifecycle/IPC.

---

## Automation Lab

v0.5.0 introduced the first production Automation Lab slice. v0.5.1 hardens its real Windows UX.

### AI Automation Composer

KeyMaster can generate a **draft** of rules/macros through an OpenAI-compatible provider and requires explicit installation before anything is written to the active profile.

- Provider profiles are configured once in **Settings → AI providers**.
- Each profile stores a name, endpoint and model in KeyMaster settings.
- The API key is stored separately in **Windows Credential Manager**, not in plaintext profile/config JSON.
- Editing a provider with an empty key field keeps the already stored key.
- Composer uses the selected saved provider; the key does not need to be pasted for every request or after every restart.
- Plain `http://` is accepted only for localhost providers; remote providers must use TLS (`https://`).
- Provider/network failures cross the Rust boundary as stable error codes and are localized in EN/RU.
- Generated output is visibly marked as a **draft / not installed**.
- Prompt and generated draft survive navigation away from Automation Lab and back during the app session.
- Rules/macros are re-deserialized and validated by the Rust daemon before any profile write.
- Installation creates a backup and an Undo receipt.
- After successful AI installation KeyMaster reloads the profile and opens **Rules** so the installed rules are immediately visible.

A typical Groq-compatible profile can use:

```text
Name:     Groq
Endpoint: https://api.groq.com/openai/v1
Model:    <your OpenAI-compatible Groq model id>
API key:  saved once in Windows Credential Manager
```

### MCP bridge

KeyMaster exposes a local stdio MCP server through the installed executable:

- `KeyMaster-Pro.exe --mcp` — read-only profile/status reads plus rule validation.
- `KeyMaster-Pro.exe --mcp-write` — explicit opt-in for profile activation, macro execution and rule writes.

Claude Desktop / Claude Code local stdio example:

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

Use `--mcp-write` only when write/execute access is deliberately required.

The current local bridge exposes seven tools across profile listing/reading, runtime status, rule validation, profile activation, macro execution and rule installation. Writes use the same canonical Rust automation boundary as the GUI.

**ChatGPT scope:** the shipped bridge is local stdio. Remote MCP hosting/authentication for ChatGPT is a separate future task.

### `keymaster-pack` v1

Portable Automation Lab bundles use:

```json
{
  "format": "keymaster-pack",
  "version": 1
}
```

Safety rules:

- import limit: **2 MiB**, checked before and after file read/parsing;
- local inspection reports permissions and high-risk actions before install;
- imported macro/layer/folder/rule UUIDs are regenerated and internal references are rebound;
- duplicate IDs, dangling references, folder cycles, empty actions and malformed payloads are rejected;
- final acceptance uses the same Rust validation/write boundary as AI and MCP;
- installation is backup-first and Undo-capable.

---

## Validation

The Windows CI used for v0.5.1 runs:

```text
Vitest frontend tests
TypeScript + Vite build
cargo check --all-targets --locked
cargo test --locked
ESLint
real-process MCP stdio smoke
```

The MCP smoke builds a real KeyMaster executable, launches an isolated daemon, connects with the official MCP client and exercises both read-only/write modes, all seven tools, persistence, backup/Undo protection and concurrent profile mutations.

---

## Important current limitations

The following are intentionally **not** claimed as complete in v0.5.1:

- reliable secure/password-field detection for Text Expansion across arbitrary applications and browsers;
- a dedicated public portable ZIP release asset;
- a full user-facing backup browser/restore center beyond current backup + Automation Lab Undo safeguards;
- a separate explicit layer-priority model beyond rule priority/order;
- general scripting/plugin APIs and browser automation;
- cloud sync/account infrastructure;
- remote MCP hosting for ChatGPT;
- the second Automation Hub layer such as diff/conflict analysis, signed catalog/marketplace and discovery.

See [`ROADMAP.md`](ROADMAP.md) for remaining work.

---

## Architecture

```text
┌──────────────────────────────────┐
│ GUI: Tauri + React/TypeScript    │
│ rules, macros, profiles, AI Lab │
└────────────────┬─────────────────┘
                 │ Named Pipes / JSON-RPC
┌────────────────▼─────────────────┐
│ Rust daemon                     │
│ compiler + engine + input state │
│ context + macro + safe writes   │
└────────────┬───────────┬─────────┘
             │           │
        keyboard       mouse
        LL hook        LL hook
             │           │
        immediate     macro worker
        simulator     / state machines
```

Core guarantees:

- one daemon owns the Named Pipe/input engines at a time;
- unsupported conditions must not silently fail open;
- low-level hooks stay free of slow file/network work;
- advanced input state machines stay bounded;
- macro delays do not block immediate remaps;
- profile mutations are serialized and validated before write;
- migrations remain backward compatible and non-destructive.

---

## Download

### Installer (recommended)

Open [**GitHub Releases**](https://github.com/zsanya322-maker/keymaster-pro/releases/latest) and download the Windows installer for the latest release.

The installed application can update itself through the built-in signed updater.

### MSI

An x64 MSI can also be produced by the release workflow.

### WinGet

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

---

## Privacy and input handling

KeyMaster Pro needs low-level keyboard and mouse hooks to remap input. Those APIs can also be used by keyloggers, so security software may treat this class of utility cautiously.

The project processes input events in memory for matching/remapping and does not intentionally persist a keystroke history. Text Expansion keeps only a bounded in-memory buffer. Profiles/settings remain local. AI provider API keys are stored separately through Windows Credential Manager. The built-in updater contacts GitHub Releases when checking/downloading updates.

---

## Development history / roadmap

Completed major sequence:

- **0.3.0** — modifier/key combinations, expanded key model and nested rule-tree foundation;
- **0.3.1** — mouse trigger completion and macro playback/control;
- **0.3.2** — profiles, auto-switch/manual lock and richer context matching;
- **0.3.3** — Text Expansion templates, delimiter modes and undo;
- **0.4.0** — Leader Keys, Sequences, ordinary-key Chords and Mouse Gestures;
- **0.4.1** — simplified rule UX, first-class Macro Library and schema v7;
- **0.5.0** — Automation Lab, AI Composer, local MCP bridge and `keymaster-pack` v1;
- **0.5.1** — persistent AI provider profiles/keys and Composer navigation/install UX fixes.

Future work is tracked in [`ROADMAP.md`](ROADMAP.md).

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
