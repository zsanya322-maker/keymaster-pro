from pathlib import Path


def replace(path: str, old: str, new: str, expected: int = 1) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise RuntimeError(f"{path}: expected {expected} matches, got {count}: {old[:120]!r}")
    p.write_text(text.replace(old, new), encoding="utf-8")


engine = "src-tauri/src/daemon/engine.rs"

replace(
    engine,
    """        for rule in rules {
            if modifiers_match(rule.required_modifiers, event_modifiers)
                && check_conditions(&rule.conditions, &ctx)
            {
                let actions = rule.actions.clone();
                let required_modifiers = rule.required_modifiers;
                drop(ctx);
                if is_key_down && required_modifiers != 0 {
                    if let Ok(mut active) = ACTIVE_COMBO_ACTIONS.lock() {
                        active.insert(vk_code, actions.clone());
                    }
                }
                return execute_actions(
                    &actions,
                    simulator,
                    &ctx_arc,
                    is_key_down,
                    state,
                    required_modifiers,
                );
            }
        }""",
    """        for rule in rules {
            // KeyDown rules keep their normal down/up lifecycle so a plain remap
            // can hold the output key until the source key is released. KeyUp
            // rules, however, are only activated on the release edge.
            let edge_matches = if rule.trigger_on_down {
                true
            } else {
                !is_key_down
            };
            if !edge_matches
                || !modifiers_match(rule.required_modifiers, event_modifiers)
                || !check_conditions(&rule.conditions, &ctx)
            {
                continue;
            }

            let actions = rule.actions.clone();
            let required_modifiers = rule.required_modifiers;
            let trigger_on_down = rule.trigger_on_down;
            drop(ctx);

            if trigger_on_down {
                if is_key_down && required_modifiers != 0 {
                    if let Ok(mut active) = ACTIVE_COMBO_ACTIONS.lock() {
                        active.insert(vk_code, actions.clone());
                    }
                }
                return execute_actions(
                    &actions,
                    simulator,
                    &ctx_arc,
                    is_key_down,
                    state,
                    required_modifiers,
                );
            }

            // A KeyUp trigger is a one-shot activation at release time. Run a
            // synthetic action press+release pair so TypeText/Macro/Launch and
            // RemapKey all behave consistently on the release edge.
            execute_actions(
                &actions,
                simulator,
                &ctx_arc,
                true,
                state,
                required_modifiers,
            );
            return execute_actions(
                &actions,
                simulator,
                &ctx_arc,
                false,
                state,
                required_modifiers,
            );
        }""",
)

replace(
    engine,
    """        for rule in rules {
            if check_conditions(&rule.conditions, &ctx) {
                drop(ctx);
                return execute_actions(&rule.actions, simulator, &ctx_arc, is_down, state, 0);
            }
        }""",
    """        for rule in rules {
            // MouseDown keeps the historical press/release lifecycle. MouseUp is
            // an explicit one-shot activation on release. More mouse trigger
            // types are introduced in 0.3.1 on top of this edge-correct base.
            if !check_conditions(&rule.conditions, &ctx) {
                continue;
            }
            if rule.trigger_on_down {
                drop(ctx);
                return execute_actions(&rule.actions, simulator, &ctx_arc, is_down, state, 0);
            }
            if !is_down {
                let actions = rule.actions.clone();
                drop(ctx);
                execute_actions(&actions, simulator, &ctx_arc, true, state, 0);
                return execute_actions(&actions, simulator, &ctx_arc, false, state, 0);
            }
        }""",
)

# Add focused modifier matching tests at end of engine module.
p = Path(engine)
text = p.read_text(encoding="utf-8")
if "fn generic_modifier_accepts_either_side()" not in text:
    text += r'''

#[cfg(test)]
mod chord_tests {
    use super::*;

    #[test]
    fn generic_modifier_accepts_either_side() {
        assert!(modifiers_match(key_modifiers::CTRL, key_modifiers::LCTRL));
        assert!(modifiers_match(key_modifiers::CTRL, key_modifiers::RCTRL));
        assert!(modifiers_match(
            key_modifiers::CTRL | key_modifiers::SHIFT,
            key_modifiers::LCTRL | key_modifiers::RSHIFT,
        ));
    }

    #[test]
    fn exact_side_modifier_is_strict() {
        assert!(modifiers_match(key_modifiers::LCTRL, key_modifiers::LCTRL));
        assert!(!modifiers_match(key_modifiers::LCTRL, key_modifiers::RCTRL));
        assert!(!modifiers_match(
            key_modifiers::LCTRL,
            key_modifiers::LCTRL | key_modifiers::RCTRL,
        ));
    }

    #[test]
    fn unrequested_extra_modifier_does_not_match() {
        assert!(!modifiers_match(
            key_modifiers::CTRL,
            key_modifiers::LCTRL | key_modifiers::SHIFT,
        ));
        assert!(modifiers_match(0, 0));
        assert!(!modifiers_match(0, key_modifiers::ALT));
    }
}
'''
    p.write_text(text, encoding="utf-8")

print("v0.3.0 trigger edge fix applied")
