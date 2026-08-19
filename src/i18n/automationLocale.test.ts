import { afterEach, describe, expect, it } from 'vitest'
import i18n from './index'
import ru from './locales/automation.ru.json'
import en from './locales/automation.en.json'

function leafKeys(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return [prefix]
  if (typeof value !== 'object' || value === null) return [prefix]
  return Object.entries(value).flatMap(([key, child]) => leafKeys(child, prefix ? `${prefix}.${key}` : key))
}

afterEach(async () => {
  await i18n.changeLanguage('ru')
})

describe('Automation Lab i18n', () => {
  it('keeps Russian and English locale key sets identical', () => {
    expect(leafKeys(en).sort()).toEqual(leafKeys(ru).sort())
  })

  it('renders real Russian strings', async () => {
    await i18n.changeLanguage('ru')
    expect(i18n.t('automation.ai.generate')).toBe('Создать draft')
    expect(i18n.t('automation.errors.pack_invalid_json')).toContain('некорректный JSON')
    expect(i18n.t('automation.ai.api_key')).toContain('Windows Credential Manager')
    expect(i18n.t('automation.ai.not_installed')).toContain('ещё не установлен')
    expect(i18n.t('nav.automation')).toBe('Automation Lab')
  })

  it('renders real English strings without falling back to Russian', async () => {
    await i18n.changeLanguage('en')
    expect(i18n.t('automation.ai.generate')).toBe('Create draft')
    expect(i18n.t('automation.errors.pack_invalid_json')).toBe('Pack file contains invalid JSON')
    expect(i18n.t('automation.ai.api_key')).toContain('Windows Credential Manager')
    expect(i18n.t('automation.ai.not_installed')).toContain('not installed')
    expect(i18n.t('automation.mcp.chatgpt_scope')).toContain('remote MCP')
  })
})
