# KeyMaster Pro — Development Roadmap

> **Source of truth for development after v0.5.1.**
>
> `README.md` / `README.ru.md` describe current stable capabilities. `CHANGELOG.md` records shipped work. This file contains only remaining or future work.

## Baseline: v0.5.1

The core remapping/macro/profile cycle and the first Automation Lab vertical slice are shipped. v0.5.1 is now the baseline for further development.

### Completed release sequence

| Release | Status | Main scope |
|---|---:|---|
| **0.3.0** | ✅ complete | Modifier/key combinations, chord-capable key model, expanded VK picker, nested rule-folder foundation |
| **0.3.1** | ✅ complete | Mouse wheel/hwheel/double-click/move triggers, macro playback controls, cancellation/emergency stop |
| **0.3.2** | ✅ complete | Structured profile bindings, auto-switch/manual lock, rich foreground context matching |
| **0.3.3** | ✅ complete | Text Expansion modes, date/time/clipboard templates, bounded undo |
| **0.4.0** | ✅ complete | Leader sequences, key sequences, ordinary-key chord sets, mouse gestures |
| **0.4.1** | ✅ complete | Simplified rule UX, first-class Macro Library, schema v7 |
| **0.5.0** | ✅ complete | Automation Lab, AI Composer, local MCP stdio bridge, `keymaster-pack` v1, canonical write safety |
| **0.5.1** | ✅ complete | Persistent AI provider profiles/API keys, Composer navigation/install UX hotfix |

Do not treat any item above as future work again. Detailed shipped history belongs in [`CHANGELOG.md`](CHANGELOG.md).

---

# Current foundation

v0.5.1 already includes:

- dual-process Tauri GUI + Rust daemon architecture;
- low-level keyboard and mouse hooks;
- modifier chords and key/mouse remapping;
- Tap-Hold, Leader Sequence, Key Sequence, ordinary-key Chord Set and Mouse Gesture triggers;
- rule priorities, enable/disable and nested folders;
- layers with toggle/hold and `LayerActive` conditions;
- structured `contextMatch` with ANY/ALL semantics;
- structured profile bindings, auto-switch and manual profile lock;
- first-class per-profile Macro Library referenced by `macroId`;
- macro speed/repeat/repeat-while-held, preview, stop and emergency stop;
- Text Expansion instant/delimiter modes, `{{date}}`, `{{time}}`, `{{clipboard}}` and undo;
- schema-aware profile persistence with backward migrations, backups, atomic writes and damaged-profile recovery;
- hardened Named Pipe JSON-RPC lifecycle and single-daemon ownership;
- serialized/canonical automation write boundary shared by GUI and MCP;
- Automation Lab with OpenAI-compatible AI draft generation and explicit install;
- saved AI provider profiles with API keys stored in Windows Credential Manager;
- local MCP stdio read-only/write modes and seven tools;
- `keymaster-pack` v1 import/export with inspection, size bounds, UUID regeneration and reference validation;
- Automation Lab backup/Undo receipts with stale-Undo protection;
- Russian/English UI, themes, tray, autostart and signed GitHub updater.

---

# Near-term priorities after v0.5.1

The exact patch/minor numbers are intentionally not fixed here. Keep each change independently testable and assign a version only when implementation scope is real.

## 1. Real-world Windows validation

The current priority is confidence in the shipped surface, not another large trigger family.

### Target

- continue manual Windows testing of AI provider save/restart/use flows;
- exercise AI draft → navigate away → return → install → Rules flows on the installed release;
- broaden end-to-end smoke tests for keyboard modifiers, advanced triggers and mouse paths;
- test profile switching while input is active;
- stress repeated macro start/stop/cancel cycles;
- verify emergency-stop behavior while keys/buttons are held;
- exercise migrations from every public historical profile version;
- validate signed installer/update flows against actual published artifacts.

### Definition of done

- no known stuck-key/stuck-button path from supported triggers/actions;
- no fail-open unsupported-condition path;
- no migration path silently drops rules/macros/folders/profile bindings;
- no long macro or advanced-trigger wait blocks ordinary immediate remaps;
- saved AI provider credentials survive normal restart/update flows without plaintext config leakage.

---

## 2. Automation Lab / AI Composer polish

The first safe AI vertical slice is shipped. Further work should improve provider management and draft ergonomics without bypassing the canonical install boundary.

### Target

- provider connection/test action with clear localized errors;
- clearer provider status and missing-key state;
- better draft diff/summary before install;
- richer preview of created macros/rules without pretending the draft is already installed;
- additional provider compatibility testing across OpenAI-compatible services and local endpoints;
- keep all AI writes behind explicit user confirmation, Rust validation, backup and Undo.

### Security rule

Provider API keys must remain local and must not be written to normal profile/config JSON or logs. Any future secret-storage refactor must preserve that property.

---

## 3. Automation Hub — second layer

This is **not part of v0.5.1**. Build it only after the first Automation Lab slice is stable in normal use.

### Target

- local diff/conflict detector before installing a pack;
- clearer merge/replace/skip decisions for existing rules/macros;
- signed catalog metadata and publisher identity model;
- provenance/version information for installed packs;
- safe update/uninstall story for previously installed packs;
- discovery/marketplace UX only after signature/trust semantics are defined.

### Safety rule

A remote catalog must never turn download into silent execution. Imported content still passes local parsing, inspection, canonical Rust validation and explicit install.

---

## 4. Remote MCP / ChatGPT integration

The shipped MCP bridge is local stdio. Remote exposure is a separate security and product problem.

### Target

- define remote MCP transport and authentication;
- explicit read-only vs write/execute authorization model;
- threat review for exposing profile/macro tools outside the local machine;
- secure pairing/revocation and auditability;
- only then evaluate a ChatGPT-facing connector/app flow.

Do not expose the existing local write bridge directly to the internet.

---

## 5. Macro Library polish

### Remaining product work

- improve navigation/organization for large macro libraries;
- improve long mixed keyboard/mouse step editing;
- make preview/stop state more visible;
- expose clearer playback status/errors;
- keep deletion/refactoring safe when a macro is referenced by multiple rules;
- expand regression coverage for duplicate/import/export and historical migration edge cases.

### Architecture rule

`MacroDefinition` remains the source of truth for steps. Rule actions carry only the macro reference plus playback options.

---

## 6. Rules tree and organization polish

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

## 7. Layers: explicit ordering/priority

Layers work for toggle/hold activation and `LayerActive` conditions, but layer metadata is still intentionally small.

### Target

- define explicit layer ordering/priority semantics;
- define deterministic conflict resolution when multiple active layers contain matching rules;
- expose ordering clearly in the UI;
- preserve existing layer IDs and current behavior through migration.

Do not create a second hotkey engine for layers. Layer activation must remain ordinary actions in the unified rules engine.

---

## 8. Backup / restore UX

The persistence layer already has migrations, backups, atomic writes, damaged-profile recovery and Automation Lab Undo receipts. The missing part is a broader user-facing recovery workflow.

### Target

- list available profile/config backups;
- preview metadata before restore;
- validate a backup before replacing current data;
- provide explicit export/restore flows;
- never overwrite the only known-good copy before validation;
- keep recovery compatible with future schema rejection rules.

---

## 9. Portable distribution and release hygiene

### Target

- add a deliberate public portable ZIP release asset;
- distinguish stable portable builds from dev/checkpoint binaries;
- keep NSIS/MSI/updater artifacts version-aligned;
- keep README EN/RU, CHANGELOG and ROADMAP synchronized for every public release;
- add an automated release-doc consistency check so a release cannot advertise an obsolete stable version again.

---

## 10. UI / localization polish

### Target

- continue reducing mixed EN/RU technical wording in normal user flows;
- normalize friendly key/input names across pickers and summaries;
- audit hardcoded spacing/scale assumptions;
- improve focus/keyboard navigation in compact editors;
- keep the current dense desktop layout readable rather than returning to oversized card-style UI.

---

# Deferred work

The following areas remain intentionally deferred until the current engine/UI/persistence/Automation Lab surface is stable in real use:

- general scripting language or arbitrary user-code execution;
- browser automation;
- third-party plugin API;
- cloud sync;
- account/service infrastructure;
- public marketplace/discovery beyond a defined signed-pack trust model.

These are not implied promises for the next minor release.

---

# Repository / architecture rules

1. **A UI control alone is not a finished feature.** Schema, migration, compiler/runtime, persistence, UI and tests must agree.
2. **Unsupported conditions never fail open.** Imported or future conditions must not silently become global rules.
3. **Low-level hook callbacks stay fast.** No file I/O, network I/O, long sleeps or expensive context queries in hook paths.
4. **Advanced input stays bounded.** Leader/sequence/chord/gesture state machines must keep explicit length/time bounds.
5. **Immediate remaps never wait for macro delays.** Preserve separate simulator/macro execution paths.
6. **Migrations are backward compatible and non-destructive.** Back up before destructive rewrites and reject unsupported future schemas.
7. **Manual user intent wins.** Auto-switch/background behavior must not fight explicit profile selection.
8. **One source of truth per state domain.** Do not reintroduce duplicate stores, duplicate profile representations or inline macro copies.
9. **Automation writes have one canonical boundary.** GUI, AI, packs and MCP must not grow divergent validators/write paths.
10. **Secrets stay out of ordinary config.** Provider API keys must remain in dedicated local secret storage and out of logs.
11. **README describes stable reality.** Planned or partial functionality belongs here, not in capability claims.
12. **CHANGELOG is mandatory for public releases.** Every published version must be added when it ships.

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
persistence / import-export / secret storage
        ↓
regression tests
        ↓
Windows build / installer / updater smoke
        ↓
README + CHANGELOG + ROADMAP sync
```

If any layer disagrees with the others, the feature is not finished.
