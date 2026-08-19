# Changelog

All notable public changes to KeyMaster Pro are tracked here.

This file describes **shipped releases**. Planned work belongs in [`ROADMAP.md`](ROADMAP.md).

## [Unreleased]

### Documentation

- Synchronized `README.md` and `README.ru.md` with the actual stable release, v0.4.1.
- Backfilled the missing 0.3.0 → 0.4.1 release history.
- Replaced the obsolete post-v0.2.4 roadmap with a post-v0.4.1 roadmap.

No runtime or application-code changes are included in this documentation update.

---

## [0.4.1] - 2026-08-17

### Rule UX

- Simplified the rule editor around compact **WHEN / IF / DO** blocks.
- Added compact searchable trigger/action/condition type pickers.
- Removed the old separate text/macros rule-filter workflow from the main rules page in favor of clearer dedicated flows.

### First-class Macro Library

- Added named per-profile macro objects and a dedicated Macro Library workspace.
- Rules now reference macros through `macroId` instead of embedding independent macro-step payloads.
- Added create, edit, duplicate, search, usage-count, test, stop and guarded-delete flows for macros.
- Kept production macro playback options such as speed/repeat/repeat-while-held on rule actions while reusing the named library object for the step sequence.

### Schema v7 and migration

- Bumped the profile schema to v7.
- Added v6 → v7 migration from legacy inline macro actions to named macro-library objects.
- Added round-trip, migration and independence tests so identical-looking legacy macros are not accidentally merged into one shared object.
- Hardened compiler resolution of macro IDs and macro-field normalization.

---

## [0.4.0] - 2026-08-17

### Advanced input state machine

- Added **Leader Sequence** triggers.
- Added ordinary **Key Sequence** triggers.
- Added simultaneous ordinary-key **Chord Set** triggers.
- Added directional **Mouse Gesture** triggers.
- Implemented bounded runtime state machines for advanced triggers instead of long waits inside low-level hook callbacks.
- Added priority-aware compilation and defensive bounds for sequence length, timeouts, chord skew and gesture path length.
- Hardened chord latching/release behavior and profile-reset handling so captured key releases are preserved safely.

### Schema v6

- Added persistence/schema support and editor support for all advanced-trigger variants.
- Added cross-language serde and migration regression coverage.

---

## [0.3.3] - 2026-08-17

### Text Expansion

- Added instant and delimiter-based text-expansion modes.
- Added configurable delimiters and case sensitivity.
- Added dynamic `{{date}}`, `{{time}}` and `{{clipboard}}` template tokens.
- Added date/time format selection.
- Made clipboard reads lazy: the Windows clipboard is accessed only when a fired template actually contains `{{clipboard}}`.
- Added bounded in-memory expansion state with focus/timeout reset.
- Added `Ctrl+Z` undo for the most recent eligible text-only expansion.
- Isolated synthetic undo from physically held modifiers.

### Schema v5

- Added backward-compatible text-trigger configuration and migration coverage.
- Added frontend/Rust serde-contract tests for the new fields.

### Privacy boundary

- Kept the typed-text buffer bounded and memory-only.
- The release does not claim reliable password/secure-field detection across arbitrary browsers/applications.

---

## [0.3.2] - 2026-08-17

### Profiles

- Added structured profile bindings.
- Added automatic profile switching from normalized foreground-window context.
- Added global Auto-switch ON/OFF.
- Added Manual Profile Lock so explicit manual selection can override automatic switching.
- Added profile rename, duplicate and reorder flows.

### Rich context

- Expanded the foreground context snapshot and Windows context APIs.
- Added structured `contextMatch` conditions with explicit ANY / ALL semantics.
- Added process, executable path, title, class, virtual-desktop/monitor identifiers, size bounds and fullscreen matching fields.
- Preserved legacy matching behavior through migrations instead of silently changing old rule semantics.

### Persistence/runtime behavior

- Separated manual/preferred profile intent from runtime auto-selected state to avoid background switching fighting the user or spamming config writes.
- Added migration and integration validation for profile bindings and context rules.

---

## [0.3.1] - 2026-08-15

### Mouse triggers

- Completed mouse wheel/horizontal-wheel trigger routing.
- Added double-click trigger support using Windows timing.
- Added mouse-movement rules with bounded distance/cooldown handling.
- Preserved Left/Right/Middle/X1/X2 behavior.

### Macro playback and safety

- Added macro playback configuration with speed, repeat count and repeat-while-held.
- Added cancellable macro-job runtime.
- Added editor preview/test playback and explicit stop.
- Added configurable emergency-stop handling.
- Added drag/reorder support for macro steps.
- Kept macro execution isolated from the immediate simulator queue.
- Fixed macro actions compiled from mouse-move rules and added migration/regression tests for playback settings.

### Schema v3

- Added macro-playback fields with backward-compatible defaults and migration coverage.

---

## [0.3.0] - 2026-08-15

### Keyboard combinations

- Introduced a reusable key-chord model with modifier masks.
- Added first-class `Ctrl` / `Alt` / `Shift` / `Win` combinations to keyboard triggers and remap actions.
- Added combination-to-combination remapping.
- Expanded the practical Windows VK catalogue and chord-aware key picker.
- Added deterministic modifier isolation/restore during synthetic output to reduce stuck/leaked modifier behavior.
- Preserved key-down/key-up trigger edges explicitly through compilation/runtime.

### Rules tree

- Added persistent rule folders with stable IDs, parent IDs and ordering.
- Added folder assignment/order/enabled fields to rules.
- Added the compact nested rule-tree panel and localized its core UI.

### Migration/runtime

- Migrated legacy single-key rules into the chord-capable model without changing their behavior.
- Added compiler/runtime coverage for modifiers, trigger edges and disabled rules.

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
- Disabled unsupported legacy Virtual Desktop selection in the old editor path and kept unsupported legacy conditions fail-closed.

---

## [0.2.0]

Baseline public release before the classic-UI/stability cycle.

It established the core two-process architecture, rules engine, low-level Windows input hooks, profiles, layers, Tap-Hold, basic macros/text expansion, system tray and Tauri updater that later releases hardened and expanded.
