from pathlib import Path


def replace(path: str, old: str, new: str, expected: int = 1) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise RuntimeError(f"{path}: expected {expected} matches, got {count}: {old[:100]!r}")
    file.write_text(text.replace(old, new), encoding="utf-8")


replace(
    "src/pages/RulesPage.tsx",
    "function isInvalidMouseTrigger(trigger: FrontendTrigger): boolean {\n  return isMouseTrigger(trigger) && (trigger.code < 1 || trigger.code > 5);\n}",
    "function isInvalidMouseTrigger(trigger: FrontendTrigger): boolean {\n  return (trigger.type === 'mouseDown' || trigger.type === 'mouseUp')\n    && (trigger.code < 1 || trigger.code > 5);\n}",
)

replace(
    "src/pages/RulesPage.tsx",
    """                        onChange={(chord) => setDraftRule({
                          ...draftRule,
                          trigger: { ...draftRule.trigger, ...chord },
                        })}""",
    """                        onChange={(chord) => setDraftRule({
                          ...draftRule,
                          trigger: {
                            type: draftRule.trigger.type === 'keyUp' ? 'keyUp' : 'keyDown',
                            code: chord.code,
                            modifiers: chord.modifiers,
                          },
                        })}""",
)

replace(
    "src/pages/RulesPage.tsx",
    """                          onChange={(chord) => setDraftRule({
                            ...draftRule,
                            trigger: { ...draftRule.trigger, code: chord.code },
                          })}""",
    """                          onChange={(chord) => setDraftRule({
                            ...draftRule,
                            trigger: {
                              type: 'tapHoldKeyDown',
                              code: chord.code,
                              timeoutMs: draftRule.trigger.type === 'tapHoldKeyDown'
                                ? draftRule.trigger.timeoutMs
                                : 200,
                            },
                          })}""",
)

replace(
    "src/pages/RulesPage.tsx",
    """                        onChange={(event) => setDraftRule({
                          ...draftRule,
                          trigger: { ...draftRule.trigger, code: Number.parseInt(event.target.value, 10) || 1 },
                        })}""",
    """                        onChange={(event) => setDraftRule({
                          ...draftRule,
                          trigger: {
                            type: draftRule.trigger.type === 'mouseUp' ? 'mouseUp' : 'mouseDown',
                            code: Number.parseInt(event.target.value, 10) || 1,
                          },
                        })}""",
)

replace(
    "src-tauri/src/daemon/runner.rs",
    """            rules: vec![],
            layers: vec![],
        };""",
    """            rules: vec![],
            layers: vec![],
            folders: vec![],
        };""",
)

replace(
    "src-tauri/src/shared/persistence.rs",
    """            rules: vec![],
            layers: vec![],
        };""",
    """            rules: vec![],
            layers: vec![],
            folders: vec![],
        };""",
    expected=2,
)

replace(
    "src-tauri/src/shared/persistence.rs",
    "Some(1)",
    "Some(PROFILE_SCHEMA_VERSION as u64)",
    expected=2,
)

print("v0.3.0 compatibility fixup applied")
