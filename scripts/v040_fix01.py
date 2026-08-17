from pathlib import Path
p = Path('src/components/ruleBuilder/AdvancedTriggerEditor.tsx')
text = p.read_text(encoding='utf-8')
old = "import React from 'react';\n"
if old not in text:
    raise SystemExit('unused React import anchor not found')
p.write_text(text.replace(old, '', 1), encoding='utf-8')
print('v040 fix01 applied')
