import { useEffect, useMemo, useRef, useState } from 'react'
import type { FrontendAction, FrontendCondition, FrontendTrigger } from '../../lib/types'

type Option = {
  value: string
  label: string
  description: string
  group: string
  keywords?: string
}

interface PickerProps {
  value: string
  options: Option[]
  onChange: (value: string) => void
  disabled?: boolean
  widthClass?: string
}

function CompactTypePicker({ value, options, onChange, disabled, widthClass = 'w-[190px]' }: PickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.value === value)

  useEffect(() => {
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [])

  const groups = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    const filtered = needle
      ? options.filter((option) => `${option.label} ${option.description} ${option.keywords ?? ''}`.toLocaleLowerCase().includes(needle))
      : options
    const grouped = new Map<string, Option[]>()
    for (const option of filtered) grouped.set(option.group, [...(grouped.get(option.group) ?? []), option])
    return [...grouped.entries()]
  }, [options, query])

  return (
    <div ref={rootRef} className={`relative shrink-0 ${widthClass}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => { setOpen((value) => !value); setQuery('') }}
        className="h-7 w-full px-2 border border-app-border bg-app-surface/35 text-[10px] text-left text-app-text hover:bg-app-surface disabled:opacity-50 flex items-center gap-2"
      >
        <span className="truncate">{selected?.label ?? 'Выбрать…'}</span>
        <span className="ml-auto text-app-muted">▾</span>
      </button>
      {open && (
        <div className="absolute z-50 left-0 top-8 w-[340px] max-w-[70vw] border border-app-border bg-app-bg shadow-xl">
          <div className="p-1.5 border-b border-app-border">
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Найти…"
              className="h-7 w-full border border-app-border bg-app-bg px-2 text-[10px] text-app-text outline-none focus:border-app-primary"
            />
          </div>
          <div className="max-h-[360px] overflow-y-auto py-1">
            {groups.length === 0 && <div className="px-2 py-3 text-[10px] text-app-muted">Ничего не найдено</div>}
            {groups.map(([group, items]) => (
              <div key={group} className="pb-1">
                <div className="px-2 pt-1.5 pb-1 text-[9px] uppercase tracking-wide text-app-muted">{group}</div>
                {items.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => { onChange(option.value); setOpen(false) }}
                    className={`w-full px-2 py-1.5 text-left hover:bg-app-surface ${option.value === value ? 'bg-app-primary/8' : ''}`}
                  >
                    <div className="text-[10px] font-medium text-app-text">{option.label}</div>
                    <div className="mt-0.5 text-[9px] leading-4 text-app-muted">{option.description}</div>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const triggerOptions: Option[] = [
  { value: 'keyDown', label: 'Клавиша / комбинация', description: 'Обычная горячая клавиша, например Ctrl+F8.', group: 'Основные', keywords: 'hotkey keyboard' },
  { value: 'mouseDown', label: 'Кнопка мыши', description: 'Левая, правая, средняя или боковая кнопка.', group: 'Основные', keywords: 'mouse' },
  { value: 'typedText', label: 'Введено сокращение', description: 'Текстовая подстановка после набора последовательности.', group: 'Основные', keywords: 'text expansion' },
  { value: 'tapHoldKeyDown', label: 'Короткое / долгое нажатие', description: 'Разные действия для tap и hold одной клавиши.', group: 'Клавиатура' },
  { value: 'keySequence', label: 'Последовательность клавиш', description: 'Несколько клавиш строго по порядку.', group: 'Клавиатура' },
  { value: 'leaderSequence', label: 'Лидер + последовательность', description: 'Сначала leader, затем короткая последовательность.', group: 'Клавиатура' },
  { value: 'keyChordSet', label: 'Аккорд из 3+ клавиш', description: 'Несколько клавиш, нажатых почти одновременно.', group: 'Клавиатура' },
  { value: 'keyUp', label: 'Клавиша отпущена', description: 'Продвинутый триггер на отпускание клавиши.', group: 'Клавиатура · дополнительно' },
  { value: 'mouseWheel', label: 'Колесо мыши', description: 'Вертикальное или горизонтальное колесо.', group: 'Мышь' },
  { value: 'mouseDoubleClick', label: 'Двойной клик', description: 'Двойное нажатие выбранной кнопки мыши.', group: 'Мышь' },
  { value: 'mouseGesture', label: 'Жест мышью', description: 'Удержание кнопки + цепочка направлений.', group: 'Мышь' },
  { value: 'mouseUp', label: 'Кнопка мыши отпущена', description: 'Продвинутый триггер на отпускание.', group: 'Мышь · дополнительно' },
  { value: 'mouseMove', label: 'Движение мыши', description: 'Срабатывание после заданной дистанции.', group: 'Мышь · дополнительно' },
]

const actionOptions: Option[] = [
  { value: 'remapKey', label: 'Клавиша / комбинация', description: 'Нажать другую клавишу или сочетание.', group: 'Часто используемые', keywords: 'remap keyboard' },
  { value: 'remapMouse', label: 'Кнопка мыши', description: 'Нажать другую кнопку мыши.', group: 'Часто используемые' },
  { value: 'runMacro', label: 'Запустить макрос', description: 'Запустить макрос из библиотеки.', group: 'Часто используемые', keywords: 'macro' },
  { value: 'typeText', label: 'Ввести текст', description: 'Напечатать текст, дату, время или буфер обмена.', group: 'Часто используемые' },
  { value: 'launchApp', label: 'Запустить программу', description: 'Открыть EXE, ярлык, BAT или CMD.', group: 'Приложения и окна' },
  { value: 'focusProcess', label: 'Переключиться на окно', description: 'Найти уже открытое приложение или окно.', group: 'Приложения и окна' },
  { value: 'windowAction', label: 'Управление окном', description: 'Свернуть, развернуть, закрыть или привязать окно.', group: 'Приложения и окна' },
  { value: 'systemVolume', label: 'Громкость', description: 'Громче, тише или mute.', group: 'Медиа и система' },
  { value: 'mediaKey', label: 'Мультимедиа', description: 'Play/Pause, следующий, предыдущий, стоп.', group: 'Медиа и система' },
  { value: 'monitorOff', label: 'Выключить монитор', description: 'Системная команда отключения дисплея.', group: 'Медиа и система' },
  { value: 'toggleLayer', label: 'Переключить слой', description: 'Включить или выключить слой.', group: 'Слои' },
  { value: 'holdLayer', label: 'Удерживать слой', description: 'Активировать слой на время удержания.', group: 'Слои' },
  { value: 'sleep', label: 'Пауза', description: 'Системная пауза в цепочке действий.', group: 'Дополнительно' },
]

const conditionOptions: Option[] = [
  { value: 'contextMatch', label: 'Приложение / окно', description: 'Ограничить правило процессом, заголовком или контекстом окна.', group: 'Ограничения', keywords: 'window process app context' },
  { value: 'layerActive', label: 'Активен слой', description: 'Выполнять правило только при активном слое.', group: 'Ограничения' },
]

export function TriggerTypePicker({ value, onChange, disabled }: { value: FrontendTrigger['type']; onChange: (value: FrontendTrigger['type']) => void; disabled?: boolean }) {
  return <CompactTypePicker value={value} options={triggerOptions} onChange={(next) => onChange(next as FrontendTrigger['type'])} disabled={disabled} />
}

export function ActionTypePicker({ value, onChange, disabled }: { value: FrontendAction['type']; onChange: (value: FrontendAction['type']) => void; disabled?: boolean }) {
  return <CompactTypePicker value={value} options={actionOptions} onChange={(next) => onChange(next as FrontendAction['type'])} disabled={disabled} widthClass="w-[170px]" />
}

export function ConditionTypePicker({ value, onChange, disabled }: { value: FrontendCondition['type']; onChange: (value: FrontendCondition['type']) => void; disabled?: boolean }) {
  const effective = value === 'windowMatch' ? 'contextMatch' : value
  return <CompactTypePicker value={effective} options={conditionOptions} onChange={(next) => onChange(next as FrontendCondition['type'])} disabled={disabled} widthClass="w-[170px]" />
}
