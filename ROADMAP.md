# KeyMaster Pro — Development Roadmap

> **Source of truth for development after v0.2.4.**
>
> README files describe only features that work in the current stable release. Planned or partial functionality belongs here. `CHANGELOG.md` records what has actually shipped.

## Baseline: v0.2.4

v0.2.4 is the stability foundation for the next feature cycle.

Already completed before starting the work below:

- dual-process GUI + daemon architecture;
- low-level keyboard and mouse hooks;
- single-key keyboard triggers and L/R/M/X1/X2 mouse-button triggers;
- Tap-Hold;
- static typed-text expansion;
- layer toggle/hold and `LayerActive` conditions;
- `WindowMatch` by process name and/or window title;
- recorded keyboard/mouse macros with per-step delays;
- separate immediate and macro simulator queues, so macro `Delay` does not block ordinary remaps;
- manual profile create/save/delete/import/export/activate;
- versioned profile/config persistence (`schemaVersion: 1`), migrations, backups and atomic writes;
- damaged-profile recovery/fallback and future-schema protection;
- hardened Named Pipe JSON-RPC lifecycle, bounded IPC timeouts and single-daemon ownership;
- tray, autostart, updater, Russian/English UI, light/dark themes;
- classic compact application shell and inline rule editor;
- CI, Windows checkpoints and signed updater releases.

### Known v0.2.4 limitations

These are **not** considered completed features:

- modifier combinations such as `Ctrl+Shift+F2` are not first-class triggers/actions yet;
- the key picker exposes only a limited friendly VK catalogue;
- wheel/horizontal-wheel/double-click are not rule triggers;
- macro speed/repeat/while-held/cancel/emergency-stop/test-playback are incomplete;
- profile `linkedApps` data exists, but automatic app-based profile switching is not active;
- Virtual Desktop matching is not implemented; legacy Virtual Desktop conditions are kept only for compatibility and compile fail-closed;
- text expansion has no date/time/clipboard variables, delimiters or undo;
- rules are still a flat list rather than a folder/tree model.

---

# Release sequence

The exact patch/minor number may change if a stability release is needed, but the dependency order should not.

| Target | Main scope |
|---|---|
| **0.3.0** | Keyboard combinations + rule model v2 + full key picker + rules/tree foundation |
| **0.3.1** | Mouse trigger completion + macro playback/control completion |
| **0.3.2** | Profiles, auto-switch/manual lock, richer context matching, Virtual Desktop |
| **0.3.3** | Text Expansion completion |
| **0.4.0** | Leader Keys, Sequences, ordinary-key Chords, Mouse Gestures |

The version boundary is less important than keeping each layer testable and backward compatible.

---

# 1. Keyboard combinations

## Current state

`FrontendTrigger::KeyDown/KeyUp` contains one `code: u8`. Modifier keys can be selected as ordinary keys, but there is no first-class model for a chord such as `Ctrl + Shift + F2`. `RemapKey` also emits a single key.

## Target

Support:

- `Ctrl`, `Alt`, `Shift`, `Win`;
- left/right variants where useful;
- any combination of modifiers;
- the complete practical Windows VK set with friendly names;
- hot-record of a combination in the picker;
- combination-to-combination remaps;
- combinations that launch macros/actions.

Examples:

```text
Ctrl + Shift + F2  ->  Alt + Tab
Win + Q            ->  Run Macro
Ctrl + Alt + M     ->  Toggle Layer
```

## Implementation direction

- Introduce a reusable `KeyChord`/modifier-mask representation instead of encoding combinations as unrelated rules.
- Keep old profile JSON valid: legacy `KeyDown { code }` migrates to the same key with an empty modifier set.
- Index compiled keyboard rules by the primary key and match the modifier mask inside the hook/engine path.
- Add a chord-capable output action so simulator presses modifiers before the primary key and releases them in a deterministic reverse order.
- Ensure cancellation/error paths never leave a modifier logically stuck down.
- Replace the small hand-written key catalogue with a complete Windows-oriented VK catalogue while preserving `VK_<number>` fallback for unknown/imported codes.
- KeyPicker hot-record should capture the current modifier state plus the primary non-modifier key and render a compact localized name.

## Acceptance criteria

- `Ctrl+Shift+F2 -> Alt+Tab` works on press/release without stuck keys.
- left/right modifier variants are preserved when explicitly selected.
- ordinary single-key v0.2.4 profiles behave identically after migration.
- tests cover serialization/migration, modifier matching and simulator press/release ordering.

---

# 2. Mouse completion

## Current state

Rules support mouse button down/up for Left, Right, Middle, X1 and X2. Macro recording/playback already has mouse movement and vertical scroll primitives, but the rule trigger schema exposes much less than the hook can observe.

## Target

- Left / Right / Middle;
- X1 / X2;
- wheel up / down;
- horizontal wheel left / right;
- double click;
- mouse movement where it makes sense as a rule/input primitive;
- configurable sensitivity;
- scroll direction/inversion.

## Implementation direction

- Add explicit wheel/hwheel trigger variants instead of pretending wheel events are buttons.
- Route `WM_MOUSEWHEEL` and `WM_MOUSEHWHEEL` through typed trigger events including signed delta.
- Add a bounded double-click state machine per button using Windows timing/config where possible.
- Keep raw movement recording for macros separate from future gesture recognition.
- Treat sensitivity/scroll inversion as explicit settings or actions, not hidden hook-side multipliers.
- Do not block the low-level mouse callback while waiting to determine a double-click.

## Acceptance criteria

- wheel up/down and horizontal wheel can independently trigger rules;
- X1/X2 behavior remains backward compatible;
- double-click does not swallow unrelated single clicks;
- macro mouse recording remains unaffected;
- tests cover wheel sign, X buttons and double-click timing boundaries.

---

# 3. Macros

## Current state

Keyboard/mouse macro recording exists. `MacroStep` stores `delayMs`, and playback is isolated from immediate remaps in a separate worker. This is a good base, but playback control is still basic.

## Target

- preserve original recorded delays;
- editable delays;
- playback speed multiplier;
- repeat `N` times;
- repeat while trigger is held;
- stop current macro;
- configurable emergency stop;
- test/play directly from the editor;
- drag-and-drop/reorder steps;
- keyboard + mouse actions in the same sequence;
- safe cancellation that releases any keys/buttons held by the macro.

## Implementation direction

- Keep macro jobs separate from the immediate simulator queue.
- Introduce macro job IDs and a cancellation token/state rather than killing the worker thread.
- Add playback options (`speed`, repeat mode/count) to the macro action/model with defaults that reproduce v0.2.4 behavior.
- Scale delays at playback time; do not destructively rewrite recorded timing data when changing speed.
- Track keys/buttons pressed by a running macro so cancellation/emergency-stop can release them safely.
- Add an IPC preview/test command that uses the same production playback path as a real rule.
- Reordering in UI changes the step list only; it must not create a second macro representation.

## Acceptance criteria

- a long macro delay never blocks ordinary remaps;
- 0.5x/2x speed changes timing without changing stored delays;
- repeat count and while-held stop deterministically;
- emergency stop releases held keys/buttons;
- editor preview and runtime execution produce the same command stream.

---

# 4. Layers

## Current state

Toggle Layer, Hold Layer and `LayerActive` conditions work. Multiple active layers are stored as a set; there is no explicit layer priority model.

## Target

- activation by hotkey/rule;
- hold-layer;
- toggle-layer;
- explicit priority/order;
- context-aware layer use;
- process/path/title conditions;
- additional context conditions;
- Virtual Desktop support after a real Windows implementation exists.

## Implementation direction

- Keep layer activation as actions in the unified rules engine rather than building a second hotkey system.
- Add stable ordering/priority metadata to layers and define conflict resolution when more than one active layer contains matching rules.
- Preserve existing layer IDs during migrations.
- Do not expose Virtual Desktop as selectable until runtime detection is implemented and tested.

### Virtual Desktop

The current frontend/Rust schema still contains a legacy `VirtualDesktop` condition for compatibility. It is **not implemented as a real runtime matcher**. The compiler intentionally converts it into a condition that cannot match, preventing old/imported rules from silently executing on every desktop.

For the real implementation:

- isolate Windows desktop detection behind a tracker/adapter;
- prefer documented Windows APIs where possible;
- choose and document a stable persisted identifier (do not assume a UI desktop index is stable across sessions);
- add migration for the legacy numeric `id` field;
- only then re-enable the condition in the editor.

---

# 5. Profiles

## Current state

Profiles can be created, saved, deleted, imported, exported and manually activated. Persistence/recovery is hardened in v0.2.4. `linkedApps` is stored, but the foreground-window tracker currently only updates process/title context; it does not activate profiles automatically.

## Target

- create;
- delete;
- duplicate;
- rename;
- reorder;
- import/export;
- user-facing backup/restore;
- quick switching from tray;
- automatic switching by application;
- **Auto-switch ON/OFF**;
- **Manual lock ON/OFF**.

Example:

```text
Photoshop.exe -> Photoshop Profile
```

When Manual Lock is enabled after the user manually selects `Gaming`, foreground changes must not immediately replace that profile.

## Implementation direction

Do **not** implement auto-switch by repeatedly overwriting `activeProfileId` in config.

Separate these concepts:

- preferred/manual profile;
- runtime active profile;
- auto-switch enabled state;
- manual-lock state;
- matched application binding.

This avoids the old failure mode where automatic activation fought the user's manual selection and changed the startup profile on every foreground event.

Profile bindings should evolve from a bare `linkedApps: string[]` toward structured bindings that can later use process/path/title conditions without another incompatible format.

## Acceptance criteria

- manual profile selection is stable across restart;
- auto-switch can be globally disabled;
- manual lock wins over auto-switch;
- switching foreground windows does not spam config writes;
- tray switching uses the same profile activation API as the main UI;
- duplicate gets new IDs for the profile and any nested entities that require uniqueness;
- backup/restore never overwrites the only good copy before validation.

---

# 6. Text Expansion

## Current state

Typed text is buffered in memory and can match a static sequence that executes ordinary actions such as `TypeText`. There is no persistent keystroke log.

## Target

- ordinary abbreviations;
- date;
- time;
- clipboard;
- delimiters;
- instant expansion;
- `Ctrl+Z` undo of the most recent expansion;
- optional variables/templates.

Examples:

```text
;date  ->  15.08.2026
;mail  ->  a stored mail/template expansion
```

## Implementation direction

- Replace the bare `TypedText { sequence }` trigger with a backward-compatible text-trigger configuration containing mode/delimiter/case options.
- Add a small template-expansion layer for dynamic tokens such as date/time/clipboard; keep it local and deterministic.
- Clipboard access must occur only when an expansion that requests clipboard data actually fires.
- Undo state stays in memory and stores only what is necessary to restore the immediately preceding expansion.
- Preserve the no-input-logging guarantee.
- v0.3.3 does not claim reliable password/secure-field detection across arbitrary browsers/apps; the buffer is bounded, memory-only, timeout/focus-reset, and never persisted.

## Acceptance criteria

- legacy static expansions migrate unchanged;
- instant and delimiter modes are independently testable;
- date/time formatting is deterministic/localized according to explicit settings;
- `Ctrl+Z` restores the original abbreviation for the last expansion without creating an expansion loop.

---

# 7. Advanced triggers (post-MVP wave)

Target for the next wave after the core items above:

- **Leader Keys**;
- **Sequences**;
- **Chords** of ordinary keys;
- **Mouse Gestures**.

Examples:

```text
CapsLock -> F -> F  ->  launch/focus Firefox
J + K simultaneously -> action
```

Here, **Chord** means simultaneous ordinary keys. This is separate from the modifier-combination work (`Ctrl+Shift+F2`) planned earlier.

Implementation should use a dedicated bounded input state machine rather than growing ad-hoc timers inside low-level hook callbacks.

---

# 8. Context rules

## Current state

`WindowMatch` supports process name and/or title substring. When both are present, current behavior is OR/ANY matching.

## Target

- process name;
- executable path;
- window title;
- window class;
- resolution/window size;
- Virtual Desktop;
- fullscreen state;
- monitor;
- explicit ANY/ALL matching where relevant.

Example:

```text
process = chrome.exe
AND title contains "CRM"
-> enable CRM-specific rule set
```

## Implementation direction

- Expand `AppContext` and the foreground tracker once, then let conditions consume that normalized snapshot.
- Introduce a structured context matcher with explicit operators instead of continuously adding unrelated optional fields.
- Preserve old `WindowMatch` semantics during migration: an old process+title condition must continue to behave as ANY/OR unless the user changes it.
- Cache expensive context data outside hook callbacks.
- Path/class/monitor/fullscreen/desktop lookup must happen on context change, not per keystroke.

---

# 9. Profiles / Rules tree

## Current state

Rules are stored and displayed as a flat array.

## Target

- folders;
- groups;
- nesting;
- drag-and-drop;
- sorting/reordering;
- duplicate;
- enable/disable;
- fast context menu.

Example:

```text
Работа
├─ CRM
│  ├─ F2 -> Ответить
│  └─ F3 -> Завершить звонок
└─ Browser
   └─ Mouse X1 -> Back

Игры
├─ CS2
└─ GTA
```

## Data-model direction

Prefer a **flat persisted model with IDs** over recursively nesting complete rules inside folders:

```text
RuleFolder { id, name, parentId?, order }
Rule       { ..., folderId?, order, enabled }
```

Benefits:

- simpler migrations;
- stable rule IDs;
- cheap drag/drop moves;
- easier duplicate/delete operations;
- compiler can simply ignore disabled rules and folder metadata.

Legacy profiles migrate every existing rule to root, preserve array order and default to `enabled = true`.

---

# 10. Settings and polish

## Already substantially addressed by v0.2.4

- real application version is obtained from the packaged app instead of a stale About-dialog hardcode;
- custom confirm/text dialogs exist instead of relying on browser `prompt()`/`confirm()` for the main flows;
- UAC/restart-as-admin lifecycle was hardened;
- persistence migration/recovery regression tests exist;
- updater/restart/exit participate in dirty-draft/config flush protection;
- documentation truthfulness is being reset by this roadmap/README pass.

## Remaining

- finish audit of hardcoded UI scale/spacing assumptions;
- expand and normalize key names/localization;
- i18n cleanup: no mixed EN/RU technical labels in normal user flows;
- portable ZIP as a deliberate release asset, not only a dev/checkpoint artifact;
- user-visible backup/restore tooling;
- keep README feature tables tied to actual stable capabilities;
- maintain `CHANGELOG.md` for every public release;
- keep Windows release/checkpoint validation part of the definition of done.

---

# Repository / architecture rules for future work

1. **No feature is “done” because the UI exists.** A feature is done only when schema, compiler/engine, UI, persistence/migration and tests agree.
2. **No fail-open unsupported conditions.** Unsupported/imported conditions must not silently turn into global rules.
3. **Low-level hook callbacks stay fast.** No file I/O, network I/O, long sleeps or expensive context queries in the hook path.
4. **Immediate remaps must not wait for macro delays.** Preserve the separate simulator queues introduced before v0.2.4.
5. **Profile/config migrations are backward compatible and non-destructive.** Backup before destructive rewrites; reject unsupported future schemas.
6. **Manual user intent wins.** Auto-switching/background automation must not fight explicit profile selection or silently rewrite preferences.
7. **One source of truth per state domain.** Avoid duplicate stores/parallel profile models.
8. **README describes stable reality.** Planned features live here, shipped changes live in `CHANGELOG.md`.
9. **Every release candidate must pass frontend build, Rust check/tests, lint and a Windows package build before updater publication.**
10. **No scope jump to scripting/cloud/plugins until the core input model is complete and stable.**

---

# Deferred beyond the current roadmap

Keep these out of the 0.3.x core-completion cycle unless priorities explicitly change:

- Rhai scripting;
- browser automation/extension;
- terminal/PTY automation;
- plugin ecosystem;
- cloud sync;
- AI features;
- marketplace/community package distribution.

The objective first is a dependable Windows remapper/macro/layer/text-expansion utility with a compact desktop UX and a complete core input model.