# Changelog

All notable public changes to KeyMaster Pro are tracked here.

This file describes **shipped releases**. Planned work belongs in [`ROADMAP.md`](ROADMAP.md).

## [Unreleased]

### Documentation

- Reset the repository roadmap after the v0.2.4 stability cycle.
- Split documentation responsibilities: README = current stable capabilities, ROADMAP = planned work, CHANGELOG = shipped work.
- Correct stale feature claims around modifier combinations, Virtual Desktop, automatic profile switching, rule-tree support and status-bar telemetry.

No user-facing feature changes are included in this documentation pass.

---

## [0.2.4] - 2026-08-15

### Stability and data safety

- Added versioned profile/config persistence with `schemaVersion: 1`.
- Added backward-compatible legacy migration and protection against unsupported future schemas.
- Added backup-before-destructive-write safeguards and atomic Windows writes.
- Hardened damaged-profile recovery: broken sources are preserved, recovery entries remain visible, and a healthy fallback profile is selected when possible.
- Made profile import/export schema-aware and tightened create/save/delete/default-profile invariants.

### Daemon lifecycle and IPC

- Hardened single-daemon ownership by reserving the Named Pipe before input engines/hooks start.
- Replaced invasive daemon-readiness probing with a non-client pipe availability check.
- Added bounded JSON-RPC connect/write/read timeouts and request/response ID validation.
- Hardened event subscription/reconnect and shutdown acknowledgement.
- Improved stop/start/restart, UAC handoff and early `WM_QUIT` handling.

### Engine and architecture

- Kept immediate input simulation and macro playback on separate queues/workers.
- Added regression tests proving a macro `Delay` cannot block ordinary remap commands.
- Split application shell/polling/toast responsibilities out of the previously monolithic `App.tsx`.
- Removed duplicate profile state/store paths and consolidated the frontend store layout.

### Release validation

- Full TypeScript/Vite build, Rust check/tests and ESLint validation.
- Signed Windows NSIS/MSI updater release.

---

## [0.2.3] - 2026-08-15

### UI

- Added the **Soft Light** palette for the light theme.
- Reduced pure-white surface area, border contrast and accent intensity without changing the application layout or feature set.

---

## [0.2.2] - 2026-08-15

### UI and localization

- Second classic-desktop UI pass based on the real Windows build.
- Made the Rules workspace denser and more desktop-like.
- Removed duplicated search UI and several developer-facing labels/codes from normal flows.
- Simplified the inline rule editor and compacted toolbar/sidebar/list presentation.
- Improved Russian localization and legacy language migration.

### Stability

- Continued configuration persistence, dirty-rule protection and lifecycle hardening carried forward from the 0.2.1 work.

---

## [0.2.1] - 2026-08-15

### Classic shell / rule editing

- Reworked the main application into a compact classic Windows-style shell with menu, toolbar, collapsible sidebar and status bar.
- Replaced the large modal-centric rule workflow with an inline rule editor workspace.
- Added protection against losing unsaved rule drafts when changing rules, sections, profiles, closing, restarting or updating.

### Persistence and lifecycle

- Added validated GUI configuration persistence and serialized writes.
- Improved daemon runtime configuration reload, stop/start/restart and graceful shutdown.
- Hardened single-instance and UAC restart behavior.
- Strengthened profile persistence, migration/recovery and backend invariants.
- Disabled unsupported Virtual Desktop selection in normal UI and made legacy conditions fail closed through the compiler path.

---

## [0.2.0]

Baseline public release before the current classic-UI/stability cycle.

It established the core two-process architecture, rules engine, low-level Windows input hooks, profiles, layers, Tap-Hold, basic macros/text expansion, system tray and Tauri updater that later 0.2.x releases hardened and refined.
