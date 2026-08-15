from pathlib import Path

PATH = Path('src-tauri/src/daemon/engine.rs')
text = PATH.read_text(encoding='utf-8')


def replace(old: str, new: str, expected: int = 1) -> None:
    global text
    count = text.count(old)
    if count != expected:
        raise RuntimeError(f'expected {expected} matches, got {count}: {old[:140]!r}')
    text = text.replace(old, new, expected)


replace(
'''static PHYSICAL_MODIFIERS: AtomicU16 = AtomicU16::new(0);
static ACTIVE_COMBO_ACTIONS: LazyLock<Mutex<HashMap<u8, Vec<EngineAction>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
''',
'''static PHYSICAL_MODIFIERS: AtomicU16 = AtomicU16::new(0);

#[derive(Clone)]
struct InputLifecycle {
    actions: Vec<EngineAction>,
    trigger_modifiers: u16,
}

/// Rule selection is bound to the physical press lifecycle. We must not
/// re-evaluate modifiers/window/layer on release, otherwise a remapped output
/// can stay stuck when context changes while the key is held.
static ACTIVE_KEY_DOWN_ACTIONS: LazyLock<Mutex<HashMap<u8, InputLifecycle>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static PENDING_KEY_UP_ACTIONS: LazyLock<Mutex<HashMap<u8, InputLifecycle>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static ACTIVE_MOUSE_DOWN_ACTIONS: LazyLock<Mutex<HashMap<u8, Vec<EngineAction>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static PENDING_MOUSE_UP_ACTIONS: LazyLock<Mutex<HashMap<u8, Vec<EngineAction>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
''')

replace(
'''pub fn reset_modifier_state() {
    PHYSICAL_MODIFIERS.store(0, Ordering::Relaxed);
    if let Ok(mut active) = ACTIVE_COMBO_ACTIONS.lock() {
        active.clear();
    }
}
''',
'''pub fn reset_modifier_state() {
    PHYSICAL_MODIFIERS.store(0, Ordering::Relaxed);
    if let Ok(mut active) = ACTIVE_KEY_DOWN_ACTIONS.lock() {
        active.clear();
    }
    if let Ok(mut pending) = PENDING_KEY_UP_ACTIONS.lock() {
        pending.clear();
    }
    if let Ok(mut active) = ACTIVE_MOUSE_DOWN_ACTIONS.lock() {
        active.clear();
    }
    if let Ok(mut pending) = PENDING_MOUSE_UP_ACTIONS.lock() {
        pending.clear();
    }
}
''')

old_keyboard = '''    // If a modifier-combo rule matched on key-down, its release must run even
    // when the user releases Ctrl/Alt/Shift/Win before the primary key. This is
    // especially important for HoldLayer actions.
    if !is_key_down {
        if let Ok(mut active) = ACTIVE_COMBO_ACTIONS.lock() {
            if let Some(actions) = active.remove(&vk_code) {
                drop(active);
                return execute_actions(&actions, simulator, &ctx_arc, false, state, 0);
            }
        }
    } else if let Ok(active) = ACTIVE_COMBO_ACTIONS.lock() {
        if active.contains_key(&vk_code) {
            return EventAction::Block;
        }
    }

    if let Some(rules) = engine_schema.keyboard_map.get(&vk_code) {
        let Some(ctx) = try_read_ctx(&ctx_arc) else {
            return EventAction::PassThrough;
        };
        for rule in rules {
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
        }
    }

    EventAction::PassThrough
'''
new_keyboard = '''    // Complete the exact rule selected on the physical key-down. Release is not
    // allowed to depend on the *current* modifiers/window/layer state.
    if !is_key_down {
        if let Ok(mut pending) = PENDING_KEY_UP_ACTIONS.lock() {
            if let Some(lifecycle) = pending.remove(&vk_code) {
                drop(pending);
                execute_actions(
                    &lifecycle.actions,
                    simulator,
                    &ctx_arc,
                    true,
                    state,
                    lifecycle.trigger_modifiers,
                );
                return execute_actions(
                    &lifecycle.actions,
                    simulator,
                    &ctx_arc,
                    false,
                    state,
                    lifecycle.trigger_modifiers,
                );
            }
        }
        if let Ok(mut active) = ACTIVE_KEY_DOWN_ACTIONS.lock() {
            if let Some(lifecycle) = active.remove(&vk_code) {
                drop(active);
                return execute_actions(
                    &lifecycle.actions,
                    simulator,
                    &ctx_arc,
                    false,
                    state,
                    lifecycle.trigger_modifiers,
                );
            }
        }
    } else {
        // Windows autorepeat produces extra key-downs without a matching up.
        // Preserve repeat for ordinary single-key rules, but keep modifier
        // combinations one-shot until the primary key is physically released.
        if let Ok(active) = ACTIVE_KEY_DOWN_ACTIONS.lock() {
            if let Some(lifecycle) = active.get(&vk_code).cloned() {
                drop(active);
                if lifecycle.trigger_modifiers == 0 {
                    return execute_actions(
                        &lifecycle.actions,
                        simulator,
                        &ctx_arc,
                        true,
                        state,
                        0,
                    );
                }
                return EventAction::Block;
            }
        }
        if let Ok(pending) = PENDING_KEY_UP_ACTIONS.lock() {
            if pending.contains_key(&vk_code) {
                return EventAction::Block;
            }
        }
    }

    if is_key_down {
        if let Some(rules) = engine_schema.keyboard_map.get(&vk_code) {
            let Some(ctx) = try_read_ctx(&ctx_arc) else {
                return EventAction::PassThrough;
            };
            for rule in rules {
                if !modifiers_match(rule.required_modifiers, event_modifiers)
                    || !check_conditions(&rule.conditions, &ctx)
                {
                    continue;
                }

                let lifecycle = InputLifecycle {
                    actions: rule.actions.clone(),
                    trigger_modifiers: rule.required_modifiers,
                };
                let trigger_on_down = rule.trigger_on_down;
                drop(ctx);

                if trigger_on_down {
                    if let Ok(mut active) = ACTIVE_KEY_DOWN_ACTIONS.lock() {
                        active.insert(vk_code, lifecycle.clone());
                    }
                    return execute_actions(
                        &lifecycle.actions,
                        simulator,
                        &ctx_arc,
                        true,
                        state,
                        lifecycle.trigger_modifiers,
                    );
                }

                // KeyUp rules suppress the source key from the first down, then
                // activate exactly once when that same physical press is released.
                // Mask Alt/Win immediately because their primary key is blocked.
                if lifecycle.trigger_modifiers != 0 {
                    send_commands(
                        simulator,
                        shell_mask_commands(current_physical_modifiers()),
                    );
                }
                if let Ok(mut pending) = PENDING_KEY_UP_ACTIONS.lock() {
                    pending.insert(vk_code, lifecycle);
                }
                return EventAction::Block;
            }
        }
    }

    EventAction::PassThrough
'''
replace(old_keyboard, new_keyboard)

old_mouse = '''    if let Some(rules) = engine_schema.mouse_map.get(&button) {
        let Some(ctx) = try_read_ctx(&ctx_arc) else {
            return EventAction::PassThrough;
        };
        for rule in rules {
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
        }
    }

    EventAction::PassThrough
'''
new_mouse = '''    if !is_down {
        if let Ok(mut pending) = PENDING_MOUSE_UP_ACTIONS.lock() {
            if let Some(actions) = pending.remove(&button) {
                drop(pending);
                execute_actions(&actions, simulator, &ctx_arc, true, state, 0);
                return execute_actions(&actions, simulator, &ctx_arc, false, state, 0);
            }
        }
        if let Ok(mut active) = ACTIVE_MOUSE_DOWN_ACTIONS.lock() {
            if let Some(actions) = active.remove(&button) {
                drop(active);
                return execute_actions(&actions, simulator, &ctx_arc, false, state, 0);
            }
        }
    } else {
        if ACTIVE_MOUSE_DOWN_ACTIONS
            .lock()
            .map(|active| active.contains_key(&button))
            .unwrap_or(false)
            || PENDING_MOUSE_UP_ACTIONS
                .lock()
                .map(|pending| pending.contains_key(&button))
                .unwrap_or(false)
        {
            return EventAction::Block;
        }

        if let Some(rules) = engine_schema.mouse_map.get(&button) {
            let Some(ctx) = try_read_ctx(&ctx_arc) else {
                return EventAction::PassThrough;
            };
            for rule in rules {
                if !check_conditions(&rule.conditions, &ctx) {
                    continue;
                }
                let actions = rule.actions.clone();
                let trigger_on_down = rule.trigger_on_down;
                drop(ctx);

                if trigger_on_down {
                    if let Ok(mut active) = ACTIVE_MOUSE_DOWN_ACTIONS.lock() {
                        active.insert(button, actions.clone());
                    }
                    return execute_actions(&actions, simulator, &ctx_arc, true, state, 0);
                }

                if let Ok(mut pending) = PENDING_MOUSE_UP_ACTIONS.lock() {
                    pending.insert(button, actions);
                }
                return EventAction::Block;
            }
        }
    }

    EventAction::PassThrough
'''
replace(old_mouse, new_mouse)

# Extend tests with a small invariant test for the lifecycle container itself.
marker = '''    fn unrequested_extra_modifier_does_not_match() {
        assert!(!modifiers_match(
            key_modifiers::CTRL,
            key_modifiers::LCTRL | key_modifiers::SHIFT,
        ));
        assert!(modifiers_match(0, 0));
        assert!(!modifiers_match(0, key_modifiers::ALT));
    }
}'''
replacement = '''    fn unrequested_extra_modifier_does_not_match() {
        assert!(!modifiers_match(
            key_modifiers::CTRL,
            key_modifiers::LCTRL | key_modifiers::SHIFT,
        ));
        assert!(modifiers_match(0, 0));
        assert!(!modifiers_match(0, key_modifiers::ALT));
    }

    #[test]
    fn lifecycle_keeps_original_modifier_requirement() {
        let lifecycle = InputLifecycle {
            actions: vec![EngineAction::RemapKey { code: 0x42, modifiers: 0 }],
            trigger_modifiers: key_modifiers::CTRL | key_modifiers::SHIFT,
        };
        assert_eq!(
            lifecycle.trigger_modifiers,
            key_modifiers::CTRL | key_modifiers::SHIFT,
        );
        assert_eq!(lifecycle.actions.len(), 1);
    }
}'''
replace(marker, replacement)

PATH.write_text(text, encoding='utf-8')
print('input lifecycle patch applied')
