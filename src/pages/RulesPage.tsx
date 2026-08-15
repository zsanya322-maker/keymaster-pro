import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronRight,
  Filter,
  Keyboard,
  ListPlus,
  Mouse,
  Pencil,
  Play,
  Search,
  Settings2,
  Square,
  Trash2,
} from 'lucide-react';
import { useProfileStore } from '../store/profileStore';
import { useAppStore } from '../stores/app-store';
import { RuleBuilderModal } from '../components/RuleBuilderModal';
import type { FrontendAction, FrontendCondition, FrontendRule, FrontendTrigger } from '../lib/types';
import { vkToName } from '../lib/keyCodes';

function formatTriggerKey(trigger: FrontendTrigger): string {
  switch (trigger.type) {
    case 'keyDown':
    case 'keyUp':
    case 'mouseDown':
    case 'mouseUp':
    case 'tapHoldKeyDown':
      return vkToName(trigger.code);
    case 'typedText':
      return `“${trigger.sequence}”`;
  }
}

function formatTriggerType(trigger: FrontendTrigger, t: (key: string) => string): string {
  switch (trigger.type) {
    case 'keyDown': return t('rules.trigger_key_down');
    case 'keyUp': return t('rules.trigger_key_up');
    case 'mouseDown': return t('rules.trigger_mouse_down');
    case 'mouseUp': return t('rules.trigger_mouse_up');
    case 'tapHoldKeyDown': return t('rules.trigger_tap_hold');
    case 'typedText': return t('rules.trigger_typed');
  }
}

function isMouseTrigger(trigger: FrontendTrigger): boolean {
  return trigger.type === 'mouseDown' || trigger.type === 'mouseUp';
}

function isInvalidMouseTrigger(trigger: FrontendTrigger): boolean {
  return isMouseTrigger(trigger) && 'code' in trigger && (trigger.code < 1 || trigger.code > 5);
}

function formatConditionLabel(condition: FrontendCondition, t: (key: string) => string): string {
  switch (condition.type) {
    case 'layerActive':
      return `${t('ruleBuilder.condition_types.layerActive')}: ${condition.layerId || '—'}`;
    case 'virtualDesktop':
      return `VD ${condition.id}`;
    case 'windowMatch': {
      const parts: string[] = [];
      if (condition.process) parts.push(condition.process);
      if (condition.title) parts.push(`“${condition.title}”`);
      return `${t('ruleBuilder.condition_types.windowMatch')}: ${parts.length ? parts.join(' / ') : '—'}`;
    }
  }
}

function formatActionLabel(action: FrontendAction, t: (key: string) => string): string {
  switch (action.type) {
    case 'remapKey': return `${t('ruleBuilder.action_types.remapKey')} → ${vkToName(action.code)}`;
    case 'remapMouse': return `${t('ruleBuilder.action_types.remapMouse')} → ${vkToName(action.code)}`;
    case 'typeText': return `${t('ruleBuilder.action_types.typeText')}: “${action.text}”`;
    case 'runMacro': return `${t('ruleBuilder.action_types.runMacro')} (${action.steps.length})`;
    case 'toggleLayer': return t('ruleBuilder.action_types.toggleLayer');
    case 'holdLayer': return t('ruleBuilder.action_types.holdLayer');
    case 'systemVolume': return `${t('ruleBuilder.action_types.systemVolume')}: ${action.action}`;
    case 'mediaKey': return `${t('ruleBuilder.action_types.mediaKey')}: ${action.key}`;
    case 'windowAction': return `${t('ruleBuilder.action_types.windowAction')}: ${action.action}`;
    case 'launchApp': return `${t('ruleBuilder.action_types.launchApp')}: ${action.path}`;
    case 'focusProcess': {
      const target = [action.process, action.title].filter(Boolean).join(' / ');
      return `${t('ruleBuilder.action_types.focusProcess')}: ${target || '—'}`;
    }
    case 'sleep': return t('ruleBuilder.action_types.sleep');
    case 'monitorOff': return t('ruleBuilder.action_types.monitorOff');
  }
}

function formatRuleSummary(rule: FrontendRule, t: (key: string) => string): string {
  const firstAction = rule.actions[0];
  if (!firstAction) return '—';
  const first = formatActionLabel(firstAction, t);
  return rule.actions.length > 1 ? `${first} +${rule.actions.length - 1}` : first;
}

export const RulesPage: React.FC = () => {
  const { t } = useTranslation();
  const { profiles, activeProfileId, saveProfile } = useProfileStore();
  const daemonConnected = useAppStore(state => state.daemonConnected);
  const activeProfile = profiles.find(profile => profile.id === activeProfileId) || null;

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<FrontendRule | null>(null);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!activeProfile) {
      setSelectedRuleId(null);
      return;
    }

    const stillExists = activeProfile.rules.some(rule => rule.id === selectedRuleId);
    if (!stillExists) {
      setSelectedRuleId(activeProfile.rules[0]?.id ?? null);
    }
  }, [activeProfile, selectedRuleId]);

  const filteredRules = useMemo(() => {
    if (!activeProfile) return [];
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return activeProfile.rules;

    return activeProfile.rules.filter(rule => {
      const haystack = [
        rule.name ?? '',
        formatTriggerKey(rule.trigger),
        formatTriggerType(rule.trigger, t),
        ...rule.actions.map(action => formatActionLabel(action, t)),
      ].join(' ').toLocaleLowerCase();
      return haystack.includes(needle);
    });
  }, [activeProfile, query, t]);

  const selectedRule = activeProfile?.rules.find(rule => rule.id === selectedRuleId) ?? null;

  const handleAddRule = () => {
    setEditingRule(null);
    setIsModalOpen(true);
  };

  const handleEditRule = (rule: FrontendRule) => {
    setSelectedRuleId(rule.id);
    setEditingRule(rule);
    setIsModalOpen(true);
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (!activeProfile) return;
    const nextRules = activeProfile.rules.filter(rule => rule.id !== ruleId);
    await saveProfile({ ...activeProfile, rules: nextRules });
    if (selectedRuleId === ruleId) {
      setSelectedRuleId(nextRules[0]?.id ?? null);
    }
  };

  const handleSaveRule = async (rule: FrontendRule) => {
    if (!activeProfile) return;
    const nextRules = editingRule
      ? activeProfile.rules.map(current => current.id === rule.id ? rule : current)
      : [...activeProfile.rules, rule];

    await saveProfile({ ...activeProfile, rules: nextRules });
    setSelectedRuleId(rule.id);
    setIsModalOpen(false);
  };

  if (!activeProfile) {
    if (!daemonConnected) {
      return (
        <div className="h-full flex items-center justify-center text-app-muted">
          <div className="max-w-md text-center border border-app-border bg-app-surface px-6 py-5">
            <div className="font-semibold text-app-text">{t('rules.daemon_off_title')}</div>
            <div className="mt-2 text-xs leading-5">{t('rules.daemon_off_hint')}</div>
            <code className="block mt-3 text-[10px] bg-app-bg border border-app-border px-2 py-1.5">
              %APPDATA%\KeyMaster Pro\logs\
            </code>
          </div>
        </div>
      );
    }

    return (
      <div className="h-full flex items-center justify-center text-app-muted text-sm">
        {profiles.length > 0 ? t('rules.no_profile_select') : t('rules.loading_profiles')}
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex bg-app-bg overflow-hidden">
      {/* Compact rule list */}
      <section className="w-[43%] min-w-[360px] max-w-[620px] flex flex-col border-r border-app-border bg-app-bg min-h-0">
        <div className="h-11 px-4 flex items-center border-b border-app-border bg-app-surface/45 shrink-0">
          <h2 className="text-sm font-semibold text-app-text">{t('rules.title', 'Список правил')}</h2>
          <span className="ml-auto text-[11px] text-app-muted">{activeProfile.rules.length}</span>
        </div>

        <div className="px-3 py-2.5 flex items-center gap-2 border-b border-app-border/70 shrink-0">
          <label className="relative flex-1 min-w-0">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-app-muted pointer-events-none" />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={t('rules.search_placeholder', 'Поиск правил')}
              className="w-full h-8 pl-8 pr-3 text-xs bg-app-bg border border-app-border rounded-md outline-none focus:border-app-primary"
            />
          </label>
          <button
            type="button"
            className="h-8 w-8 border border-app-border rounded-md text-app-muted hover:text-app-text hover:bg-app-surface flex items-center justify-center"
            title={t('rules.filter', 'Фильтр')}
          >
            <Filter size={14} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {filteredRules.map(rule => {
            const selected = rule.id === selectedRuleId;
            const invalidMouse = isInvalidMouseTrigger(rule.trigger);
            const TriggerIcon = isMouseTrigger(rule.trigger) ? Mouse : Keyboard;

            return (
              <button
                key={rule.id}
                type="button"
                onClick={() => setSelectedRuleId(rule.id)}
                onDoubleClick={() => handleEditRule(rule)}
                className={`w-full min-h-[58px] px-3 py-2 text-left border-b border-app-border/55 flex items-start gap-2.5 transition-colors ${
                  selected
                    ? 'bg-app-primary/10 shadow-[inset_2px_0_0_var(--color-primary)]'
                    : 'hover:bg-app-surface-hover/45'
                }`}
              >
                <ChevronRight size={13} className="mt-1.5 shrink-0 text-app-muted" />
                <TriggerIcon size={15} className={`mt-1 shrink-0 ${invalidMouse ? 'text-app-danger' : 'text-app-primary'}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 min-w-0">
                    <strong className="text-xs font-semibold text-app-text shrink-0">
                      {formatTriggerKey(rule.trigger)}
                    </strong>
                    <span className="text-[11px] text-app-muted truncate">
                      {formatTriggerType(rule.trigger, t)}
                    </span>
                  </span>
                  <span className={`block mt-1 text-[11px] leading-4 truncate ${invalidMouse ? 'text-app-danger' : 'text-app-text-muted'}`}>
                    {invalidMouse ? t('rules.invalid_mouse_code') : formatRuleSummary(rule, t)}
                  </span>
                </span>
              </button>
            );
          })}

          {filteredRules.length === 0 && (
            <div className="py-10 px-4 text-center text-xs text-app-muted">
              {query ? t('rules.search_empty', 'Ничего не найдено') : t('rules.empty_state')}
            </div>
          )}

          <button
            type="button"
            onClick={handleAddRule}
            className="w-full h-11 px-4 text-left text-xs text-app-muted hover:text-app-primary hover:bg-app-surface flex items-center gap-2 border-b border-app-border/45"
          >
            <ListPlus size={15} />
            {t('rules.add_rule')}
          </button>
        </div>

        <div className="h-9 px-4 flex items-center border-t border-app-border bg-app-surface/35 text-[11px] text-app-muted shrink-0">
          {t('rules.total_rules', 'Всего правил')}: {activeProfile.rules.length}
        </div>
      </section>

      {/* Inspector / rule editor shell */}
      <section className="flex-1 min-w-0 flex flex-col bg-app-bg min-h-0">
        <div className="h-11 px-4 flex items-center border-b border-app-border bg-app-surface/45 shrink-0">
          <h2 className="text-sm font-semibold text-app-text">{t('rules.editor_title', 'Редактор правила')}</h2>
          {selectedRule && (
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={() => handleEditRule(selectedRule)}
                className="h-7 w-7 flex items-center justify-center border border-app-border rounded text-app-muted hover:text-app-primary hover:bg-app-surface"
                title={t('rules.edit_rule', 'Редактировать')}
              >
                <Pencil size={13} />
              </button>
              <button
                type="button"
                onClick={() => handleDeleteRule(selectedRule.id)}
                className="h-7 w-7 flex items-center justify-center border border-app-border rounded text-app-muted hover:text-app-danger hover:bg-app-surface"
                title={t('rules.delete_rule', 'Удалить')}
              >
                <Trash2 size={13} />
              </button>
            </div>
          )}
        </div>

        {!selectedRule ? (
          <div className="flex-1 flex items-center justify-center text-xs text-app-muted">
            {t('rules.select_rule_hint', 'Выберите правило слева или создайте новое')}
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto p-4">
            <div className="max-w-4xl space-y-4">
              <div className="flex items-center gap-2">
                <button type="button" className="h-8 w-8 rounded border border-app-border bg-app-surface text-app-success flex items-center justify-center" title={t('rules.preview', 'Проверить')}>
                  <Play size={14} fill="currentColor" />
                </button>
                <button type="button" className="h-8 w-8 rounded border border-app-border bg-app-surface text-app-muted flex items-center justify-center" title={t('rules.stop', 'Остановить')}>
                  <Square size={12} fill="currentColor" />
                </button>
                <button
                  type="button"
                  onClick={() => handleEditRule(selectedRule)}
                  className="h-8 w-8 rounded border border-app-border bg-app-surface text-app-muted hover:text-app-primary flex items-center justify-center"
                  title={t('rules.edit_rule', 'Редактировать')}
                >
                  <Settings2 size={14} />
                </button>
              </div>

              <div className="border border-app-border rounded-md overflow-hidden bg-app-surface/20">
                <div className="grid grid-cols-[140px_1fr] border-b border-app-border min-h-11">
                  <div className="px-3 py-2.5 text-[11px] text-app-muted bg-app-surface/55">{t('ruleBuilder.trigger')}</div>
                  <div className="px-3 py-2.5 text-xs text-app-text flex items-center gap-2">
                    {isMouseTrigger(selectedRule.trigger) ? <Mouse size={14} /> : <Keyboard size={14} />}
                    <strong>{formatTriggerKey(selectedRule.trigger)}</strong>
                    <span className="text-app-muted">{formatTriggerType(selectedRule.trigger, t)}</span>
                  </div>
                </div>
                <div className="grid grid-cols-[140px_1fr] min-h-11">
                  <div className="px-3 py-2.5 text-[11px] text-app-muted bg-app-surface/55">{t('ruleBuilder.actions')}</div>
                  <div className="px-3 py-2.5 text-xs text-app-text">
                    {selectedRule.actions.length > 0
                      ? selectedRule.actions.map(action => formatActionLabel(action, t)).join('  ·  ')
                      : '—'}
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-app-text">{t('rules.sequence_steps', 'Действия правила')}</h3>
                  <button
                    type="button"
                    onClick={() => handleEditRule(selectedRule)}
                    className="text-[11px] text-app-primary hover:underline"
                  >
                    {t('rules.edit_rule', 'Редактировать')}
                  </button>
                </div>
                <div className="border border-app-border rounded-md overflow-hidden">
                  {selectedRule.actions.map((action, index) => (
                    <div key={`${action.type}-${index}`} className="min-h-11 px-3 py-2 border-b last:border-b-0 border-app-border/60 flex items-center gap-3 bg-app-bg">
                      <span className="w-5 text-[10px] text-app-muted text-right shrink-0">{index + 1}</span>
                      <span className="flex-1 min-w-0 text-xs text-app-text truncate">{formatActionLabel(action, t)}</span>
                    </div>
                  ))}
                  {selectedRule.actions.length === 0 && (
                    <div className="px-3 py-4 text-xs text-app-muted">—</div>
                  )}
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-xs font-semibold text-app-text">{t('rules.conditions_title', 'Условия')}</h3>
                <div className="border border-app-border rounded-md min-h-11 px-3 py-2.5 flex flex-wrap items-center gap-1.5 bg-app-surface/20">
                  {selectedRule.conditions.length > 0 ? selectedRule.conditions.map((condition, index) => (
                    <span key={`${condition.type}-${index}`} className="px-2 py-1 text-[11px] border border-app-border rounded bg-app-bg text-app-text">
                      {formatConditionLabel(condition, t)}
                    </span>
                  )) : (
                    <span className="text-xs text-app-muted">{t('rules.no_conditions', 'Без дополнительных условий')}</span>
                  )}
                </div>
              </div>

              <div className="pt-1 flex justify-end">
                <button
                  type="button"
                  onClick={() => handleEditRule(selectedRule)}
                  className="h-8 px-4 rounded bg-app-primary hover:bg-app-primary-hover text-white text-xs font-semibold"
                >
                  {t('rules.edit_rule', 'Редактировать правило')}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {isModalOpen && (
        <RuleBuilderModal
          existingRule={editingRule}
          onClose={() => setIsModalOpen(false)}
          onSave={handleSaveRule}
        />
      )}
    </div>
  );
};
