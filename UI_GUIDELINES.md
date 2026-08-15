# KeyMaster Pro — UI Guidelines

> UI contract for 0.3.x and later. The application can become much more powerful without making its default workspace visually heavier.

## 1. Progressive disclosure is the default

The most common operation must stay visible and compact. Rare, expert or contextual options must appear only when the user asks for them.

Preferred hierarchy:

1. **Primary row** — the values needed for the normal case.
2. **Small `…` / `Доп.` control** — nearby uncommon options.
3. **Collapsible `Дополнительно` section** — multiple advanced fields.
4. **Context menu** — item-specific commands that are not part of everyday editing.
5. **Small focused dialog** — complex configuration that does not deserve permanent workspace space.

Do not add a permanent panel just because a setting exists.

## 2. Visual budget

Every always-visible control must justify the space it occupies.

Keep visible by default:

- current profile;
- current rule list/tree;
- trigger;
- primary action;
- save/cancel state;
- status that requires immediate user attention.

Usually hide until requested:

- exact left/right modifier variants;
- manual raw VK selection;
- priority values;
- advanced timing/timeout values;
- macro speed/repeat/cancellation policy;
- auto-switch matching details;
- executable path, window class, resolution, monitor and Virtual Desktop filters;
- gesture/sequence timing thresholds;
- diagnostics and internal identifiers.

## 3. Defaults should remove UI, not add UI

A good default means the user does not need to see the option.

Examples:

- `Ctrl + Shift + F2` is one compact KeyPicker field. Exact `LCtrl/RShift` selection lives under `…`.
- Tap-Hold shows the key. Timeout lives under `Доп.` unless changed.
- A macro shows `Play / Stop` and its steps. Speed/repeat policy lives under `Дополнительно`.
- A profile shows its name. Auto-switch rules live in profile options; Manual Lock appears prominently only while active.
- Window Match initially shows process/title. Path/class/fullscreen/monitor/desktop filters are added from an advanced condition menu.

## 4. Reveal active advanced state

Hidden does not mean invisible after configuration.

If an advanced option is active, the compact parent row must summarize it, for example:

```text
Macro: Login sequence        Repeat ×5 · 1.5×
Profile: Work                Auto · chrome.exe
Window: CRM                  +3 filters
Chord: LCtrl + F2            exact side
```

The user should never need to open every `…` menu just to discover why a rule behaves differently.

## 5. Avoid modal chains

Prefer inline editing and one focused popup over a sequence of dialogs.

A normal rule edit should remain:

```text
select rule -> edit compact fields -> save
```

Advanced configuration may open one secondary surface, but should return to the same editor state without losing the draft.

## 6. Tree/list density

Rules and profiles are navigation structures, not dashboards.

- compact rows;
- folders/groups use normal tree indentation;
- no oversized cards per rule;
- enable/disable state should be a small icon/check/context command;
- duplicate/move/delete belong in context menus or a compact toolbar;
- drag-and-drop should not add permanent instructional chrome.

## 7. Status and warnings

Only actionable or abnormal state deserves persistent emphasis.

Good persistent status:

- daemon disconnected;
- unsaved draft;
- Manual Lock active;
- invalid/migrated rule that requires attention;
- macro currently running when Stop is relevant.

Do not permanently show low-value telemetry merely because it is available.

## 8. Version-specific application

### 0.3.0

- chord is the primary KeyPicker value;
- manual VK and exact L/R modifiers under `…`;
- priority, enabled state and conditions under `Дополнительно` when not immediately relevant;
- tree metadata must not turn each rule row into a control strip.

### 0.3.1

- macro speed/repeat/while-held/emergency policy under `Дополнительно`;
- runtime Play/Stop stays visible only where it is useful;
- mouse sensitivity/inversion are not permanent rule-row fields.

### 0.3.2

- Auto-switch configuration belongs to profile options;
- Manual Lock is prominent only while enabled;
- rich context fields are opt-in filters added to a compact condition.

### 0.3.3

- normal abbreviation -> replacement stays minimal;
- delimiters, instant expansion, undo and variables are advanced options/templates.

### 0.4.0

- Leader/Sequence/Chord/Gesture editors show the recorded pattern first;
- timing tolerances and recognition thresholds remain advanced settings.

## 9. Review rule

Before merging a UI feature, ask:

> Does a user who never needs this option have to look at it every day?

If the answer is yes, the feature should normally be moved behind progressive disclosure.
