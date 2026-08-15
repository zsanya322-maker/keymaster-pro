from pathlib import Path

p = Path('src/components/rules/RuleTreePanel.tsx')
s = p.read_text(encoding='utf-8')
old = '''    case 'mouseDown':\n    case 'mouseUp':\n      return vkToName(trigger.code);\n    case 'typedText':\n      return `“${trigger.sequence}”`;\n'''
new = '''    case 'mouseDown':\n    case 'mouseUp':\n      return vkToName(trigger.code);\n    case 'mouseWheel': {\n      const arrow = { up: '↑', down: '↓', left: '←', right: '→' }[trigger.direction];\n      return `Wheel ${arrow}`;\n    }\n    case 'mouseDoubleClick':\n      return `2× ${vkToName(trigger.code)}`;\n    case 'mouseMove':\n      return 'Mouse move';\n    case 'typedText':\n      return `“${trigger.sequence}”`;\n'''
if old not in s:
    raise SystemExit('triggerText marker not found')
s = s.replace(old, new, 1)
old = '''  if (trigger.type === 'typedText') return FileText;\n  if (trigger.type === 'mouseDown' || trigger.type === 'mouseUp') return Mouse;\n  return Keyboard;\n'''
new = '''  if (trigger.type === 'typedText') return FileText;\n  if (trigger.type === 'mouseDown'\n    || trigger.type === 'mouseUp'\n    || trigger.type === 'mouseWheel'\n    || trigger.type === 'mouseDoubleClick'\n    || trigger.type === 'mouseMove') return Mouse;\n  return Keyboard;\n'''
if old not in s:
    raise SystemExit('triggerIcon marker not found')
p.write_text(s.replace(old, new, 1), encoding='utf-8')
