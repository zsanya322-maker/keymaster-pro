from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding='utf-8')

checks = {
    'package.json': ['"version": "0.4.1"'],
    'src-tauri/Cargo.toml': ['version = "0.4.1"'],
    'src-tauri/tauri.conf.json': ['"version": "0.4.1"'],
    'src-tauri/src/shared/persistence.rs': [
        'PROFILE_SCHEMA_VERSION: u32 = 7',
        '6 => {',
        'legacy-macro:',
        '"macroId"',
        '"contextMatch"',
    ],
    'src-tauri/src/shared/types.rs': ['pub macros: Vec<MacroDefinition>'],
    'src-tauri/src/schemas/frontend.rs': [
        'pub struct MacroDefinition',
        'pub macros: Vec<MacroDefinition>',
        'macro_id: String',
        'rename = "macroId"',
    ],
    'src-tauri/src/daemon/compiler.rs': [
        'let macro_library:',
        'HashMap<&str, &MacroDefinition>',
        'macro_library.get(macro_id.as_str())',
    ],
    'src-tauri/src/daemon/profile_runtime.rs': ['macros: profile.macros.clone()'],
    'src/lib/types.ts': [
        'macros: MacroDefinition[]',
        'export interface MacroDefinition',
        "type: 'runMacro'; macroId: string",
    ],
    'src/store/profileStore.ts': ['macros: profile.macros ?? []', 'macros: []'],
    'src/pages/MacroLibraryPage.tsx': [
        'export function MacroLibraryPage',
        '<MacroEditor',
        'usageCount(',
        'macro.preview',
        'Используется в',
    ],
    'src/components/ruleBuilder/RuleTypePickers.tsx': [
        'TriggerTypePicker',
        'ActionTypePicker',
        'ConditionTypePicker',
        'Найти…',
    ],
    'src/components/ruleBuilder/ActionEditor.tsx': [
        '<ActionTypePicker',
        'action.macroId',
        'selectedMacro.steps',
    ],
    'src/components/ruleBuilder/ConditionEditor.tsx': [
        '<ConditionTypePicker',
        'Все поля',
        'Любое поле',
    ],
    'src/pages/RulesPage.tsx': [
        'title="КОГДА"',
        'title="ЕСЛИ · Ограничения"',
        "title={isTapHold ? 'СДЕЛАТЬ · короткое нажатие' : 'СДЕЛАТЬ'}",
        'RuleKindFilter',
        'TriggerTypePicker',
        'Быстрый старт',
    ],
    'src/app/App.tsx': [
        'const PROFILE_SCHEMA_VERSION = 7',
        '<MacroLibraryPage />',
        'activeProfile?.macros?.length',
    ],
    'src-tauri/tests/profile_schema_v7.rs': [
        'v6_inline_macros_migrate_independently_to_named_library_objects',
        'v7_macro_reference_round_trips_without_inline_steps',
        'identical legacy macros must stay independent',
    ],
}

for path, needles in checks.items():
    content = read(path)
    for needle in needles:
        if needle not in content:
            raise SystemExit(f'audit missing {needle!r} in {path}')

absence = {
    'src/app/App.tsx': ['<RulesPage mode="macros"', '<RulesPage mode="text"', "activeCategory === 'text'"],
    'src/app/ShellSidebar.tsx': ["id: 'text'", 'FileText'],
    'src/store/keyMasterStore.ts': ["'text'"],
    'src/components/ruleBuilder/ActionEditor.tsx': ['action.steps', '<MacroEditor'],
    'src/pages/RulesPage.tsx': ['action.steps'],
}
for path, needles in absence.items():
    content = read(path)
    for needle in needles:
        if needle in content:
            raise SystemExit(f'audit forbidden legacy UX token {needle!r} remains in {path}')

# The macro action schema must no longer carry inline steps on either boundary.
for path in ['src/lib/types.ts', 'src-tauri/src/schemas/frontend.rs']:
    content = read(path)
    run_macro_pos = content.find("runMacro" if path.endswith('.ts') else 'RunMacro')
    macro_step_pos = content.find('MacroStep', run_macro_pos)
    macro_id_pos = content.find('macroId' if path.endswith('.ts') else 'macro_id', run_macro_pos)
    if run_macro_pos < 0 or macro_id_pos < 0 or (macro_step_pos >= 0 and macro_step_pos < macro_id_pos):
        raise SystemExit(f'runMacro boundary audit failed in {path}')

print('v0.4.1 static UX/schema audit passed')
