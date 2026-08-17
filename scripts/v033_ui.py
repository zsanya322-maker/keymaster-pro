from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text(encoding='utf-8')


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding='utf-8')

# ---------------------------------------------------------------------------
# RulesPage: compact trigger editor. Sequence + mode stay visible; delimiter
# characters and case sensitivity live under the existing compact "Доп." idiom.
# ---------------------------------------------------------------------------
p = 'src/pages/RulesPage.tsx'
s = read(p)
s = s.replace(
    "    case 'typedText':\n      return `“${trigger.sequence}”`;",
    "    case 'typedText':\n      return `“${trigger.sequence}” · ${trigger.mode === 'delimiter' ? 'delimiter' : 'instant'}`;",
    1,
)
s = s.replace(
    "      trigger: { type: 'typedText', sequence: '' },",
    "      trigger: { type: 'typedText', sequence: '', mode: 'instant', delimiters: ' \\t\\n.,;:!?', caseSensitive: true },",
    1,
)
s = s.replace(
    "  if (type === 'typedText') return { ...rule, trigger: { type: 'typedText', sequence: '' } };",
    "  if (type === 'typedText') return { ...rule, trigger: { type: 'typedText', sequence: '', mode: 'instant', delimiters: ' \\t\\n.,;:!?', caseSensitive: true } };",
    1,
)
old = '''                    {draftRule.trigger.type === 'typedText' && (
                      <input
                        type="text"
                        value={draftRule.trigger.sequence}
                        disabled={saving}
                        onChange={(event) => setDraftRule({ ...draftRule, trigger: { type: 'typedText', sequence: event.target.value } })}
                        placeholder={t('ruleBuilder.placeholders.sequence')}
                        className={`${inputClass} flex-1 min-w-0 max-w-[520px] disabled:opacity-50`}
                      />
                    )}'''
new = '''                    {draftRule.trigger.type === 'typedText' && (
                      <>
                        <input
                          type="text"
                          value={draftRule.trigger.sequence}
                          disabled={saving}
                          onChange={(event) => setDraftRule({ ...draftRule, trigger: { ...draftRule.trigger, sequence: event.target.value } })}
                          placeholder={t('ruleBuilder.placeholders.sequence')}
                          className={`${inputClass} flex-1 min-w-0 max-w-[330px] disabled:opacity-50`}
                        />
                        <select
                          value={draftRule.trigger.mode}
                          disabled={saving}
                          onChange={(event) => setDraftRule({
                            ...draftRule,
                            trigger: { ...draftRule.trigger, mode: event.target.value as 'instant' | 'delimiter' },
                          })}
                          className={`${selectClass} w-[112px] shrink-0 disabled:opacity-50`}
                        >
                          <option value="instant">{t('textExpansion.instant', { defaultValue: 'Сразу' })}</option>
                          <option value="delimiter">{t('textExpansion.delimiter', { defaultValue: 'По разделителю' })}</option>
                        </select>
                        <details className="relative shrink-0">
                          <summary className="list-none h-7 px-2 inline-flex items-center border border-app-border bg-app-bg text-[9px] text-app-muted hover:bg-app-surface cursor-pointer">
                            {t('common.advanced', { defaultValue: 'Доп.' })}
                          </summary>
                          <div className="absolute z-30 right-0 top-8 w-64 border border-app-border bg-app-bg shadow-lg p-2 space-y-2">
                            <label className="flex items-center gap-2 text-[10px] text-app-text">
                              <input
                                type="checkbox"
                                checked={draftRule.trigger.caseSensitive}
                                disabled={saving}
                                onChange={(event) => setDraftRule({ ...draftRule, trigger: { ...draftRule.trigger, caseSensitive: event.target.checked } })}
                              />
                              {t('textExpansion.case_sensitive', { defaultValue: 'Учитывать регистр' })}
                            </label>
                            {draftRule.trigger.mode === 'delimiter' && (
                              <label className="block">
                                <span className="block mb-1 text-[9px] text-app-muted">
                                  {t('textExpansion.delimiters', { defaultValue: 'Разделители (\\t / \\n поддерживаются)' })}
                                </span>
                                <input
                                  type="text"
                                  value={draftRule.trigger.delimiters}
                                  disabled={saving}
                                  onChange={(event) => setDraftRule({ ...draftRule, trigger: { ...draftRule.trigger, delimiters: event.target.value } })}
                                  className={`${inputClass} w-full font-mono disabled:opacity-50`}
                                />
                              </label>
                            )}
                            <div className="text-[9px] leading-4 text-app-muted">
                              {t('textExpansion.undo_hint', { defaultValue: 'Ctrl+Z отменяет только последнюю текстовую подстановку.' })}
                            </div>
                          </div>
                        </details>
                      </>
                    )}'''
if old not in s:
    raise SystemExit('RulesPage typed editor anchor missing')
s = s.replace(old, new, 1)
write(p, s)

# ---------------------------------------------------------------------------
# ActionEditor: token insertion + explicit per-action date/time formatting.
# ---------------------------------------------------------------------------
p = 'src/components/ruleBuilder/ActionEditor.tsx'
s = read(p)
s = s.replace(
    "      onChange({ type, text: '' });",
    "      onChange({ type, text: '', dateFormat: 'dmy', timeFormat: 'hm24' });",
    1,
)
old = '''            {action.type === 'typeText' && (
              <input
                type="text"
                value={action.text}
                onChange={(event) => onChange({ ...action, text: event.target.value })}
                placeholder={t('ruleBuilder.placeholders.text_to_type')}
                className={`${controlClass} flex-1 min-w-0`}
              />
            )}'''
new = '''            {action.type === 'typeText' && (
              <>
                <input
                  type="text"
                  value={action.text}
                  onChange={(event) => onChange({ ...action, text: event.target.value })}
                  placeholder={t('ruleBuilder.placeholders.text_to_type')}
                  className={`${controlClass} flex-1 min-w-0`}
                />
                <div className="shrink-0 flex items-center gap-0.5">
                  {([
                    ['{{date}}', 'Дата'],
                    ['{{time}}', 'Время'],
                    ['{{clipboard}}', 'Буфер'],
                  ] as const).map(([token, label]) => (
                    <button
                      key={token}
                      type="button"
                      onClick={() => onChange({ ...action, text: `${action.text}${token}` })}
                      className="h-7 px-1.5 border border-app-border bg-app-bg text-[9px] text-app-muted hover:bg-app-surface hover:text-app-text"
                      title={token}
                    >
                      {t(`textExpansion.token_${label}`, { defaultValue: label })}
                    </button>
                  ))}
                </div>
                <details className="relative shrink-0">
                  <summary className="list-none h-7 px-2 inline-flex items-center border border-app-border bg-app-bg text-[9px] text-app-muted hover:bg-app-surface cursor-pointer">
                    {t('common.advanced', { defaultValue: 'Доп.' })}
                  </summary>
                  <div className="absolute z-40 right-0 top-8 w-56 border border-app-border bg-app-bg shadow-lg p-2 space-y-2">
                    <label className="block">
                      <span className="block mb-1 text-[9px] text-app-muted">{t('textExpansion.date_format', { defaultValue: 'Формат даты' })}</span>
                      <select
                        value={action.dateFormat}
                        onChange={(event) => onChange({ ...action, dateFormat: event.target.value as 'dmy' | 'ymd' | 'mdy' })}
                        className={`${selectClass} w-full`}
                      >
                        <option value="dmy">DD.MM.YYYY</option>
                        <option value="ymd">YYYY-MM-DD</option>
                        <option value="mdy">MM/DD/YYYY</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="block mb-1 text-[9px] text-app-muted">{t('textExpansion.time_format', { defaultValue: 'Формат времени' })}</span>
                      <select
                        value={action.timeFormat}
                        onChange={(event) => onChange({ ...action, timeFormat: event.target.value as 'hm24' | 'hms24' | 'hm12' })}
                        className={`${selectClass} w-full`}
                      >
                        <option value="hm24">24h · HH:mm</option>
                        <option value="hms24">24h · HH:mm:ss</option>
                        <option value="hm12">12h · h:mm AM/PM</option>
                      </select>
                    </label>
                    <div className="text-[9px] leading-4 text-app-muted">
                      {t('textExpansion.clipboard_lazy', { defaultValue: 'Буфер обмена читается только если сработал шаблон с {{clipboard}}.' })}
                    </div>
                  </div>
                </details>
              </>
            )}'''
if old not in s:
    raise SystemExit('ActionEditor TypeText anchor missing')
s = s.replace(old, new, 1)
write(p, s)

# Catch legacy constructor literals elsewhere in TS/TSX without touching type aliases.
for path in list(Path('src').rglob('*.ts')) + list(Path('src').rglob('*.tsx')):
    text = path.read_text(encoding='utf-8')
    text = re.sub(
        r"\{\s*type:\s*'typedText',\s*sequence:\s*([^,}]+)\s*\}",
        r"{ type: 'typedText', sequence: \1, mode: 'instant', delimiters: ' \\t\\n.,;:!?', caseSensitive: true }",
        text,
    )
    text = re.sub(
        r"\{\s*type:\s*'typeText',\s*text:\s*([^,}]+)\s*\}",
        r"{ type: 'typeText', text: \1, dateFormat: 'dmy', timeFormat: 'hm24' }",
        text,
    )
    path.write_text(text, encoding='utf-8')

# Document the v0.3.3 secure-input limitation explicitly; no hidden promise of
# password-field/browser-field detection.
p = 'ROADMAP.md'
s = read(p)
needle = '- Preserve the no-input-logging guarantee.\n'
addition = '''- Preserve the no-input-logging guarantee.
- v0.3.3 does not claim reliable password/secure-field detection across arbitrary browsers/apps; the buffer is bounded, memory-only, timeout/focus-reset, and never persisted.
'''
if needle in s and 'v0.3.3 does not claim reliable password/secure-field detection' not in s:
    s = s.replace(needle, addition, 1)
write(p, s)

print('v0.3.3 compact UI + token controls staged')
