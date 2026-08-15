from pathlib import Path

path = Path('src/components/rules/RuleTreePanel.tsx')
text = path.read_text(encoding='utf-8')
old = """    case 'mouseDown':\n    case 'mouseUp':\n      return vkToName(trigger.code);\n    case 'typedText':\n      return `“${trigger.sequence}”`;\n"""
new = """    case 'mouseDown':\n    case 'mouseUp':\n    case 'mouseDoubleClick':\n      return vkToName(trigger.code);\n    case 'mouseWheel':\n      return trigger.direction;\n    case 'mouseMove':\n      return `move ≥ ${trigger.minDistance}px`;\n    case 'typedText':\n      return `“${trigger.sequence}”`;\n"""
if old not in text:
    raise SystemExit('triggerText anchor not found')
text = text.replace(old, new, 1)
old_icon = """  if (trigger.type === 'typedText') return FileText;\n  if (trigger.type === 'mouseDown' || trigger.type === 'mouseUp') return Mouse;\n  return Keyboard;\n"""
new_icon = """  if (trigger.type === 'typedText') return FileText;\n  if (['mouseDown', 'mouseUp', 'mouseWheel', 'mouseDoubleClick', 'mouseMove'].includes(trigger.type)) return Mouse;\n  return Keyboard;\n"""
if old_icon not in text:
    raise SystemExit('triggerIcon anchor not found')
path.write_text(text.replace(old_icon, new_icon, 1), encoding='utf-8')
print('RuleTreePanel typed mouse cases fixed')
