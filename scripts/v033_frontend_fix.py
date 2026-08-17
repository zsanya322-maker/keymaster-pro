from pathlib import Path
p = Path('src/pages/RulesPage.tsx')
s = p.read_text(encoding='utf-8')
replacements = {
"onChange={(event) => setDraftRule({ ...draftRule, trigger: { ...draftRule.trigger, sequence: event.target.value } })}": "onChange={(event) => { const sequence = event.target.value; setDraftRule((current) => current?.trigger.type === 'typedText' ? { ...current, trigger: { ...current.trigger, sequence } } : current); }}",
"onChange={(event) => setDraftRule({\n                            ...draftRule,\n                            trigger: { ...draftRule.trigger, mode: event.target.value as 'instant' | 'delimiter' },\n                          })}": "onChange={(event) => { const mode = event.target.value as 'instant' | 'delimiter'; setDraftRule((current) => current?.trigger.type === 'typedText' ? { ...current, trigger: { ...current.trigger, mode } } : current); }}",
"onChange={(event) => setDraftRule({ ...draftRule, trigger: { ...draftRule.trigger, caseSensitive: event.target.checked } })}": "onChange={(event) => { const caseSensitive = event.target.checked; setDraftRule((current) => current?.trigger.type === 'typedText' ? { ...current, trigger: { ...current.trigger, caseSensitive } } : current); }}",
"onChange={(event) => setDraftRule({ ...draftRule, trigger: { ...draftRule.trigger, delimiters: event.target.value } })}": "onChange={(event) => { const delimiters = event.target.value; setDraftRule((current) => current?.trigger.type === 'typedText' ? { ...current, trigger: { ...current.trigger, delimiters } } : current); }}",
}
for old, new in replacements.items():
    if old not in s:
        raise SystemExit(f'frontend narrowing anchor missing: {old[:70]}')
    s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
print('v0.3.3 frontend narrowing fixes applied')
