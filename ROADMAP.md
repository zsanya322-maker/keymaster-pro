# KeyMaster Pro — Development Roadmap

> **Source of truth for development after v0.4.1.**
>
> `README.md` / `README.ru.md` describe current stable capabilities. `CHANGELOG.md` records shipped work. This file contains only remaining or future work.

## Baseline: v0.4.1

The original core-completion cycle is finished. v0.4.1 is now the baseline for further development.

### Completed release sequence

| Release | Status | Main scope |
|---|---:|---|
| **0.3.0** | ✅ complete | Modifier/key combinations, chord-capable key model, expanded VK picker, nested rule-folder foundation |
| **0.3.1** | ✅ complete | Mouse wheel/hwheel/double-click/move triggers, macro playback controls, cancellation/emergency stop |
| **0.3.2** | ✅ complete | Structured profile bindings, auto-switch/manual lock, rich foreground context matching |
| **0.3.3** | ✅ complete | Text Expansion modes, date/time/clipboard templates, bounded undo |
| **0.4.0** | ✅ complete | Leader sequences, key sequences, ordinary-key chord sets, mouse gestures |
| **0.4.1** | ✅ complete | Simplified rule UX, first-class Macro Library, schema v7 |

Do not treat any item above as future work again. Detailed shipped history belongs in [`CHANGELOG.md`](CHANGELOG.md).

---

# Current foundation

v0.4.1 already includes:

- dual-process Tauri GUI + Rust daemon architecture;
- low-level keyboard and mouse hooks;
- first-class modifier chords for keyboard triggers/actions;
- mouse buttons, wheel/hwheel, double-click and movement triggers;
- Tap-Hold;
- Leader Sequence, Key Sequence, ordinary-key Chord Set and Mouse Gesture triggers;
- rule priorities, enable/disable and nested folder metadata;
- layers with toggle/hold and `LayerActive` conditions;
- structured `contextMatch` with ANY/ALL semantics;
- structured profile bindings, auto-switch and manual profile lock;
- first-class per-profile Macro Library referenced by `macroId`;
- macro speed/repeat/repeat-while-held, preview, stop and emergency stop;
- Text Expansion instant/delimiter modes, `{{date}}`, `{{time}}`, `{{clipboard}}` and undo;
- schema-v7 profile persistence with backward migrations, backups, atomic writes and damaged-profile recovery;
- hardened Named Pipe JSON-RPC lifecycle and single-daemon ownership;
- Russian/English UI, themes, tray, autostart and signed GitHub updater.

---

# Near-term priorities after v0.4.1

The exact patch/minor numbers are intentionally not fixed here. Keep each change independently testable and avoid assigning a version until the implementation scope is real.

## 1. Stability and real-world validation

The feature surface expanded quickly from 0.3.0 through 0.4.1. The next work should prioritize confidence on real Windows systems over adding another large trigger family.

### Target

- broaden end-to-end Windows smoke tests for keyboard modifiers, advanced triggers and mouse paths;
- test profile switching while input is active;
- stress repeated macro start/stop/cancel cycles;
- verify emergency-stop behavior while keys/buttons are held;
- exercise schema migrations from every public historical profile version to v7;
- add regression coverage for save/restart/update while drafts or macro edits are dirty;
- validate signed installer/update flows against the actual published artifacts.

### Definition of done

- no known stuck-key/stuck-button path from supported triggers/actions;
- no fail-open unsupported condition path;
- no migration path silently drops rules/macros/folders/profile bindings;
- no long macro or advanced-trigger wait blocks ordinary immediate remaps.

---

## 2. Macro Library polish

v0.4.1 established the correct data model: a named macro object lives once in the profile and rules reference it by ID. Future work should extend that model rather than reintroducing inline macro copies.

### Remaining product work

- improve large-library navigation and organization without changing macro identity semantics;
- improve step editing ergonomics for long mixed keyboard/mouse macros;
- make preview/stop state more visible while a macro is running;
- expose clearer playback status/errors in the UI;
- keep deletion/refactoring safe when a macro is referenced by multiple rules;
- expand regression coverage for duplicate/import/export and v6→v7 migration edge cases.

### Architecture rule

`MacroDefinition` remains the source of truth for steps. Rule actions carry only the macro reference plus playback options.

---

## 3. Rules tree and organization polish

The persisted nested-folder foundation already exists. Remaining work is primarily interaction quality and large-profile ergonomics.

### Target

- audit drag/drop and reorder behavior across nested folders;
- improve move/duplicate/context-menu flows;
- make large rule trees easier to navigate and search;
- preserve stable IDs/order through all moves and duplication;
- make disabled/foldered rules visually obvious without adding a second rule model.

### Data-model rule

Keep a flat persisted model with stable IDs:

```text
RuleFolder { id, name, parentId?, order }
Rule       { ..., folderId?, order, enabled }
```

Do not recursively embed full rules inside folder objects.

---

## 4. Layers: explicit ordering/priority

Layers work for toggle/hold activation and `LayerActive` conditions, but the layer metadata is still intentionally small.

### Target

- define explicit layer ordering/priority semantics;
- define deterministic conflict resolution when multiple active layers contain matching rules;
- expose the ordering clearly in the UI;
- preserve existing layer IDs and current behavior through migration.

Do not create a second hotkey engine for layers. Layer activation must remain ordinary actions in the unified rules engine.

---

## 5. Backup / restore UX

The persistence layer already has migration, backups, atomic writes and damaged-profile recovery. The missing part is a user-facing workflow.

### Target

- list available profile/config backups;
- preview metadata before restore;
- validate a backup before replacing current data;
- provide explicit export/restore flows;
- never overwrite the only known-good copy before validation;
- keep recovery compatible with future schema rejection rules.

---

## 6. Portable distribution and release hygiene

### Target

- add a deliberate public portable ZIP release asset;
- distinguish stable portable builds from dev/checkpoint binaries;
- keep NSIS/MSI/updater artifacts version-aligned;
- keep `README`, Russian README, `CHANGELOG` and `ROADMAP` synchronized for every public release;
- consider an automated release-doc consistency check so a release cannot advertise an obsolete stable version again.

---

## 7. UI / localization polish

### Target

- continue reducing mixed EN/RU technical wording in normal user flows;
- normalize friendly key/input names across all pickers and summaries;
- audit hardcoded spacing/scale assumptions;
- improve focus/keyboard navigation in compact editors;
- keep the current dense desktop layout readable rather than returning to oversized card-style UI.

---

# Deferred post-core work

The following areas remain intentionally deferred until the current engine/UI/persistence surface is stable in real use:

- general scripting language or user code execution;
- browser automation;
- third-party plugin API;
- cloud sync;
- account/service infrastructure;
- AI-assisted rule or macro generation;
- public template/plugin marketplace.

These are not implied promises for the next minor release.

---

# Repository / architecture rules

1. **A UI control alone is not a finished feature.** Schema, migration, compiler/runtime, persistence, UI and tests must agree.
2. **Unsupported conditions never fail open.** Imported or future conditions must not silently become global rules.
3. **Low-level hook callbacks stay fast.** No file I/O, network I/O, long sleeps or expensive context queries in hook paths.
4. **Advanced input stays bounded.** Leader/sequence/chord/gesture state machines must keep explicit length/time bounds.
5. **Immediate remaps never wait for macro delays.** Preserve the separate simulator/macro execution paths.
6. **Migrations are backward compatible and non-destructive.** Back up before destructive rewrites and reject unsupported future schemas.
7. **Manual user intent wins.** Auto-switch/background behavior must not fight explicit profile selection.
8. **One source of truth per state domain.** Do not reintroduce duplicate stores, duplicate profile representations or inline macro copies.
9. **README describes stable reality.** Planned or partial functionality belongs here, not in capability claims.
10. **CHANGELOG is mandatory for public releases.** Every published version after v0.4.1 must be added when it ships.

---

# Definition of done for future releases

Before calling a future release complete:

```text
schema / migration
        ↓
compiler + runtime
        ↓
frontend editor / UX
        ↓
persistence / import-export
        ↓
regression tests
        ↓
Windows build / installer smoke test
        ↓
README + README.ru + CHANGELOG + ROADMAP truth check
```

If one layer is missing, the feature is not finished.
