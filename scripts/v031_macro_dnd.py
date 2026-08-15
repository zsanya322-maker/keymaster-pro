from pathlib import Path

p = Path('src/components/ruleBuilder/MacroEditor.tsx')
s = p.read_text(encoding='utf-8')

old = '''  const moveStep = (index: number, direction: -1 | 1) => {\n    const targetIndex = index + direction;\n    if (targetIndex < 0 || targetIndex >= steps.length) return;\n    const next = [...steps];\n    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];\n    onChange(next);\n  };\n'''
new = old + '''\n  const moveStepTo = (fromIndex: number, targetIndex: number) => {\n    if (fromIndex < 0 || fromIndex >= steps.length || targetIndex < 0 || targetIndex >= steps.length || fromIndex === targetIndex) return;\n    const next = [...steps];\n    const [moved] = next.splice(fromIndex, 1);\n    next.splice(targetIndex, 0, moved);\n    onChange(next);\n  };\n'''
if old not in s:
    raise SystemExit('moveStep function not found')
s = s.replace(old, new, 1)

old = '''            <div\n              key={index}\n              className="min-h-10 px-1.5 py-1.5 flex items-center gap-1.5 border-b last:border-b-0 border-app-border/55 hover:bg-app-surface/20"\n            >\n'''
new = '''            <div\n              key={index}\n              draggable={!isRecording}\n              onDragStart={(event) => {\n                event.dataTransfer.effectAllowed = 'move';\n                event.dataTransfer.setData('application/x-keymaster-macro-step', String(index));\n              }}\n              onDragOver={(event) => {\n                if (!isRecording) {\n                  event.preventDefault();\n                  event.dataTransfer.dropEffect = 'move';\n                }\n              }}\n              onDrop={(event) => {\n                if (isRecording) return;\n                event.preventDefault();\n                const fromIndex = Number.parseInt(\n                  event.dataTransfer.getData('application/x-keymaster-macro-step'),\n                  10,\n                );\n                if (Number.isInteger(fromIndex)) moveStepTo(fromIndex, index);\n              }}\n              className={`min-h-10 px-1.5 py-1.5 flex items-center gap-1.5 border-b last:border-b-0 border-app-border/55 hover:bg-app-surface/20 ${isRecording ? '' : 'cursor-move'}`}\n              title={isRecording ? undefined : t('macro.drag_reorder', { defaultValue: 'Перетащите для изменения порядка' })}\n            >\n'''
if old not in s:
    raise SystemExit('macro step row not found')
p.write_text(s.replace(old, new, 1), encoding='utf-8')
