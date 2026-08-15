import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronRight,
  FileText,
  Keyboard,
  ListPlus,
  Mouse,
  RotateCcw,
  Save,
  Search,
  Trash2,
} from 'lucide-react';
import { useProfileStore } from '../store/profileStore';
import { useAppStore } from '../stores/app-store';
import { ActionEditor } from '../components/ruleBuilder/ActionEditor';
import { ConditionEditor } from '../components/ruleBuilder/ConditionEditor';
import { KeyPicker } from '../components/ruleBuilder/KeyPicker';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { FrontendAction, FrontendCondition, FrontendRule, FrontendTrigger } from '../lib/types';
import { vkToName } from '../lib/keyCodes';
import {
  RULE_COMMAND_EVENT,
  RULE_SEARCH_EVENT,
  type RuleCommand,
} from '../lib/uiEvents';

export type RulesViewMode = 'all' | 'macros' | 'text';

interface RulesPageProps {
  mode?: RulesViewMode;
}

type EditorIntent =
  | { type: 'select'; id: string }
  | { type: 'new' };

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
      return `${t('ruleBuilder.condition_types.virtualDesktop', 'Виртуальный рабочий стол')}: ${condition.id}`;
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

function matchesMode(rule: FrontendRule, mode: RulesViewMode): boolean {
  if (mode === 'all') return true;
  if (mode === 'macros') return rule.actions.some((action) => action.type === 'runMacro');
  return rule.trigger.type === 'typedText' || rule.actions.some((action) => action.type === 'typeText');
}

function makeNewRule(mode: RulesViewMode): FrontendRule {
  if (mode === 'macros') {
    return {
      id: crypto.randomUUID(),
      name: '',
      trigger: { type: 'keyDown', code: 0 },
      actions: [{ type: 'runMacro', steps: [] }],
      holdActions: [],
      conditions: [],
      priority: 0,
    };
  }

  if (mode === 'text') {
    return {
      id: crypto.randomUUID(),
      name: '',
      trigger: { type: 'typedText', sequence: '' },
      actions: [{ type: 'typeText', text: '' }],
      holdActions: [],
      conditions: [],
      priority: 0,
    };
  }

  return {
    id: crypto.randomUUID(),
    name: '',
    trigger: { type: 'keyDown', code: 0 },
    actions: [],
    holdActions: [],
    conditions: [],
    priority: 0,
  };
}

function changeTriggerType(rule: FrontendRule, type: FrontendTrigger['type']): FrontendRule {
  if (type === 'tapHoldKeyDown') return { ...rule, trigger: { type, code: 0, timeoutMs: 200 } };
  if (type === 'typedText') return { ...rule, trigger: { type, sequence: '' } };
  return { ...rule, trigger: { type, code: 0 } };
}

export const RulesPage: React.FC<RulesPageProps> = ({ mode = 'all' }) => {
  const { t } = useTranslation();
  const { profiles, activeProfileId, saveProfile } = useProfileStore();
  const daemonConnected = useAppStore((state) => state.daemonConnected);
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) || null;

  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [draftRule, setDraftRule] = useState<FrontendRule | null>(null);
  const [baseline, setBaseline] = useState('');
  const [isNewRule, setIsNewRule] = useState(false);
  const [query, setQuery] = useState('');
  const [pendingIntent, setPendingIntent] = useState<EditorIntent | null>(null);
  const [ruleToDelete, setRuleToDelete] = useState<FrontendRule | null>(null);

  const modeRules = useMemo(
    () => activeProfile?.rules.filter((rule) => matchesMode(rule, mode)) ?? [],
    [activeProfile, mode],
  );

  const filteredRules = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return modeRules;

    return modeRules.filter((rule) => {
      const haystack = [
        rule.name ?? '',
        formatTriggerKey(rule.trigger),
        formatTriggerType(rule.trigger, t),
        ...rule.conditions.map((condition) => formatConditionLabel(condition, t)),
        ...rule.actions.map((action) => formatActionLabel(action, t)),
      ].join(' ').toLocaleLowerCase();
      return haystack.includes(needle);
    });
  }, [modeRules, query, t]);

  const isDirty = Boolean(draftRule) && JSON.stringify(draftRule) !== baseline;

  const openExistingRule = (rule: FrontendRule) => {
    const copy = structuredClone(rule);
    setSelectedRuleId(rule.id);
    setDraftRule(copy);
    setBaseline(JSON.stringify(copy));
    setIsNewRule(false);
  };

  const openNewRule = () => {
    const next = makeNewRule(mode);
    setSelectedRuleId(null);
    setDraftRule(next);
    setBaseline(JSON.stringify(next));
    setIsNewRule(true);
  };

  const applyIntent = (intent: EditorIntent) => {
    if (intent.type === 'new') {
      openNewRule();
      return;
    }
    const rule = activeProfile?.rules.find((item) => item.id === intent.id);
    if (rule) openExistingRule(rule);
  };

  const requestIntent = (intent: EditorIntent) => {
    if (isDirty) {
      setPendingIntent(intent);
    } else {
      applyIntent(intent);
    }
  };

  useEffect(() => {
    if (!activeProfile) {
      setSelectedRuleId(null);
      setDraftRule(null);
      setBaseline('');
      setIsNewRule(false);
      return;
    }

    if (isNewRule) return;

    const selected = modeRules.find((rule) => rule.id === selectedRuleId);
    if (selected) {
      if (!draftRule || draftRule.id !== selected.id) openExistingRule(selected);
      return;
    }

    if (!isDirty) {
      const first = modeRules[0];
      if (first) openExistingRule(first);
      else {
        setSelectedRuleId(null);
        setDraftRule(null);
        setBaseline('');
      }
    }
  }, [activeProfileId, mode, modeRules, selectedRuleId, draftRule?.id, isDirty, isNewRule]);

  const handleSaveRule = async () => {
    if (!activeProfile || !draftRule || draftRule.actions.length === 0) return;

    const savedRule = structuredClone(draftRule);
    const nextRules = isNewRule
      ? [...activeProfile.rules, savedRule]
      : activeProfile.rules.map((rule) => rule.id === savedRule.id ? savedRule : rule);

    await saveProfile({ ...activeProfile, rules: nextRules });
    setSelectedRuleId(savedRule.id);
    setDraftRule(savedRule);
    setBaseline(JSON.stringify(savedRule));
    setIsNewRule(false);
  };

  const resetDraft = () => {
    if (isNewRule) {
      const first = modeRules[0];
      if (first) openExistingRule(first);
      else {
        setDraftRule(null);
        setBaseline('');
        setSelectedRuleId(null);
        setIsNewRule(false);
      }
      return;
    }

    const original = activeProfile?.rules.find((rule) => rule.id === selectedRuleId);
    if (original) openExistingRule(original);
  };

  const deleteRule = async (rule: FrontendRule) => {
    if (!activeProfile) return;
    const nextRules = activeProfile.rules.filter((item) => item.id !== rule.id);
    await saveProfile({ ...activeProfile, rules: nextRules });

    const nextVisible = nextRules.filter((item) => matchesMode(item, mode));
    const next = nextVisible[0] ?? null;
    if (next) openExistingRule(next);
    else {
      setSelectedRuleId(null);
      setDraftRule(null);
      setBaseline('');
      setIsNewRule(false);
    }
  };

  useEffect(() => {
    const onSearch = (event: Event) => setQuery((event as CustomEvent<string>).detail ?? '');
    window.addEventListener(RULE_SEARCH_EVENT, onSearch);
    return () => window.removeEventListener(RULE_SEARCH_EVENT, onSearch);
  }, []);

  useEffect(() => {
    const onCommand = (event: Event) => {
      const command = (event as CustomEvent<RuleCommand>).detail;
      if (command === 'add') {
        requestIntent({ type: 'new' });
      } else if (command === 'edit') {
        if (!draftRule && selectedRuleId) requestIntent({ type: 'select', id: selectedRuleId });
      } else if (command === 'delete' && draftRule && !isNewRule) {
        setRuleToDelete(draftRule);
      }
    };

    window.addEventListener(RULE_COMMAND_EVENT, onCommand);
    return () => window.removeEventListener(RULE_COMMAND_EVENT, onCommand);
  }, [draftRule, selectedRuleId, isNewRule, isDirty, activeProfile, mode]);

  if (!activeProfile) {
    if (!daemonConnected) {
      return (
        <div className="h-full flex items-center justify-center text-app-muted">
          <div className="max-w-md border border-app-border bg-app-surface px-5 py-4 text-center">
            <div className="text-xs font-semibold text-app-text">{t('rules.daemon_off_title')}</div>
            <div className="mt-1.5 text-[11px] leading-5">{t('rules.daemon_off_hint')}</div>
          </div>
        </div>
      );
    }

    return (
      <div className="h-full flex items-center justify-center text-app-muted text-xs">
        {profiles.length > 0 ? t('rules.no_profile_select') : t('rules.loading_profiles')}
      </div>
    );
  }

  const viewTitle = mode === 'macros'
    ? t('nav.macros', 'Макросы')
    : mode === 'text'
      ? t('nav.text', 'Текст')
      : t('rules.title', 'Список правил');

  const saveDisabled = !draftRule || draftRule.actions.length === 0 || !isDirty;
  const isTapHold = draftRule?.trigger.type === 'tapHoldKeyDown';

  return (
    <>
      <div className="h-full min-h-0 flex bg-app-bg overflow-hidden">
        <section className="w-[40%] min-w-[330px] max-w-[560px] flex flex-col border-r border-app-border bg-app-bg min-h-0">
          <div className="h-10 px-3 flex items-center border-b border-app-border bg-app-surface/45 shrink-0">
            <h2 className="text-xs font-semibold text-app-text">{viewTitle}</h2>
            <span className="ml-auto text-[10px] text-app-muted">{modeRules.length}</span>
          </div>

          <div className="px-2 py-2 border-b border-app-border/70 shrink-0">
            <label className="relative block min-w-0">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-app-muted pointer-events-none" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('rules.search_placeholder', 'Поиск правил')}
                className="w-full h-7 pl-7 pr-2 text-[11px] bg-app-bg border border-app-border outline-none focus:border-app-primary"
              />
            </label>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            {filteredRules.map((rule) => {
              const selected = rule.id === selectedRuleId && !isNewRule;
              const invalidMouse = isInvalidMouseTrigger(rule.trigger);
              const TriggerIcon = rule.trigger.type === 'typedText'
                ? FileText
                : isMouseTrigger(rule.trigger)
                  ? Mouse
                  : Keyboard;

              return (
                <button
                  key={rule.id}
                  type="button"
                  onClick={() => requestIntent({ type: 'select', id: rule.id })}
                  className={`w-full min-h-[52px] px-2.5 py-1.5 text-left border-b border-app-border/55 flex items-start gap-2 transition-colors ${
                    selected
                      ? 'bg-app-primary/10 shadow-[inset_2px_0_0_var(--color-primary)]'
                      : 'hover:bg-app-surface-hover/35'
                  }`}
                >
                  <ChevronRight size={12} className="mt-1.5 shrink-0 text-app-muted" />
                  <TriggerIcon size={14} className={`mt-1 shrink-0 ${invalidMouse ? 'text-app-danger' : 'text-app-primary'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 min-w-0">
                      <strong className="text-[11px] font-semibold text-app-text truncate">
                        {rule.name?.trim() || formatTriggerKey(rule.trigger)}
                      </strong>
                      <span className="text-[10px] text-app-muted truncate">{formatTriggerType(rule.trigger, t)}</span>
                    </span>
                    <span className={`block mt-0.5 text-[10px] leading-4 truncate ${invalidMouse ? 'text-app-danger' : 'text-app-muted'}`}>
                      {invalidMouse ? t('rules.invalid_mouse_code') : formatRuleSummary(rule, t)}
                    </span>
                  </span>
                </button>
              );
            })}

            {filteredRules.length === 0 && (
              <div className="py-8 px-4 text-center text-[11px] text-app-muted">
                {query ? t('rules.search_empty', 'Ничего не найдено') : t('rules.empty_state')}
              </div>
            )}

            <button
              type="button"
              onClick={() => requestIntent({ type: 'new' })}
              className="w-full h-9 px-3 text-left text-[11px] text-app-muted hover:text-app-primary hover:bg-app-surface flex items-center gap-2 border-b border-app-border/45"
            >
              <ListPlus size={13} />
              {t('rules.add_rule')}
            </button>
          </div>

          <div className="h-8 px-3 flex items-center border-t border-app-border bg-app-surface/35 text-[10px] text-app-muted shrink-0">
            {t('rules.total_rules', 'Всего правил')}: {modeRules.length}
          </div>
        </section>

        <section className="flex-1 min-w-0 flex flex-col bg-app-bg min-h-0">
          <div className="h-10 px-3 flex items-center border-b border-app-border bg-app-surface/45 shrink-0">
            <h2 className="text-xs font-semibold text-app-text">
              {isNewRule ? t('ruleBuilder.modal.create_title') : t('rules.editor_title', 'Редактор правила')}
            </h2>
            {isDirty && <span className="ml-2 text-[10px] text-app-warning">● {t('rules.unsaved', 'изменено')}</span>}

            {draftRule && (
              <div className="ml-auto flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={resetDraft}
                  disabled={!isDirty && !isNewRule}
                  className="h-7 px-2 inline-flex items-center gap-1.5 border border-app-border bg-app-bg text-[10px] text-app-text hover:bg-app-surface-hover disabled:opacity-35"
                >
                  <RotateCcw size={11} />
                  {t('ruleBuilder.buttons.cancel')}
                </button>
                {!isNewRule && (
                  <button
                    type="button"
                    onClick={() => setRuleToDelete(draftRule)}
                    className="h-7 w-7 inline-flex items-center justify-center border border-app-border bg-app-bg text-app-muted hover:bg-app-surface hover:text-app-danger"
                    title={t('rules.delete_rule', 'Удалить')}
                  >
                    <Trash2 size={12} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleSaveRule()}
                  disabled={saveDisabled}
                  className="h-7 px-3 inline-flex items-center gap-1.5 border border-app-primary bg-app-primary text-[10px] font-semibold text-white hover:bg-app-primary-hover disabled:opacity-35"
                >
                  <Save size={11} />
                  {t('ruleBuilder.buttons.save_rule')}
                </button>
              </div>
            )}
          </div>

          {!draftRule ? (
            <div className="flex-1 flex items-center justify-center text-[11px] text-app-muted">
              {t('rules.select_rule_hint', 'Выберите правило слева или создайте новое')}
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto p-3">
              <div className="max-w-5xl space-y-3">
                <section className="border border-app-border bg-app-bg">
                  <div className="h-8 px-2.5 flex items-center border-b border-app-border bg-app-surface/55 text-[11px] font-semibold text-app-text">
                    {t('ruleBuilder.tabs.name', 'Основные свойства')}
                  </div>
                  <div className="grid grid-cols-[130px_minmax(0,1fr)]">
                    <label className="min-h-9 px-2.5 flex items-center border-b border-r border-app-border/70 bg-app-surface/25 text-[10px] text-app-muted">
                      {t('ruleBuilder.tabs.name', 'Название')}
                    </label>
                    <div className="min-h-9 p-1.5 border-b border-app-border/70">
                      <input
                        type="text"
                        value={draftRule.name || ''}
                        onChange={(event) => setDraftRule({ ...draftRule, name: event.target.value })}
                        placeholder={t('ruleBuilder.placeholders.name', 'Название правила')}
                        className="h-7 w-full border border-app-border bg-app-bg px-2 text-[11px] text-app-text outline-none focus:border-app-primary"
                      />
                    </div>
                    <label className="min-h-9 px-2.5 flex items-center border-r border-app-border/70 bg-app-surface/25 text-[10px] text-app-muted">
                      {t('ruleBuilder.priority', 'Приоритет')}
                    </label>
                    <div className="min-h-9 p-1.5 flex items-center gap-2">
                      <input
                        type="number"
                        value={draftRule.priority}
                        onChange={(event) => setDraftRule({ ...draftRule, priority: Number.parseInt(event.target.value, 10) || 0 })}
                        className="h-7 w-24 border border-app-border bg-app-bg px-2 text-[11px] font-mono text-app-text outline-none focus:border-app-primary"
                      />
                      <span className="text-[10px] text-app-muted">{t('ruleBuilder.priority_hint', 'Большее значение выполняется раньше')}</span>
                    </div>
                  </div>
                </section>

                <section className="border border-app-border bg-app-bg">
                  <div className="h-8 px-2.5 flex items-center border-b border-app-border bg-app-surface/55 text-[11px] font-semibold text-app-text">
                    {t('ruleBuilder.tabs.trigger')}
                  </div>
                  <div className="p-2.5 grid grid-cols-[180px_minmax(0,1fr)] gap-2">
                    <select
                      value={draftRule.trigger.type}
                      onChange={(event) => setDraftRule(changeTriggerType(draftRule, event.target.value as FrontendTrigger['type']))}
                      className="h-7 border border-app-border bg-app-surface/45 px-2 text-[11px] text-app-text outline-none focus:border-app-primary"
                    >
                      <option value="keyDown">{t('ruleBuilder.trigger_types.keyDown')}</option>
                      <option value="keyUp">{t('ruleBuilder.trigger_types.keyUp')}</option>
                      <option value="mouseDown">{t('ruleBuilder.trigger_types.mouseDown')}</option>
                      <option value="mouseUp">{t('ruleBuilder.trigger_types.mouseUp')}</option>
                      <option value="tapHoldKeyDown">{t('ruleBuilder.trigger_types.tapHoldKeyDown')}</option>
                      <option value="typedText">{t('ruleBuilder.trigger_types.typedText')}</option>
                    </select>

                    <div className="flex gap-2 min-w-0">
                      {draftRule.trigger.type === 'typedText' ? (
                        <input
                          type="text"
                          value={draftRule.trigger.sequence}
                          onChange={(event) => setDraftRule({ ...draftRule, trigger: { type: 'typedText', sequence: event.target.value } })}
                          placeholder={t('ruleBuilder.placeholders.sequence')}
                          className="h-7 flex-1 min-w-0 border border-app-border bg-app-bg px-2 text-[11px] text-app-text outline-none focus:border-app-primary"
                        />
                      ) : (
                        <KeyPicker
                          value={draftRule.trigger.code}
                          onChange={(code) => setDraftRule({
                            ...draftRule,
                            trigger: { ...draftRule.trigger, code } as FrontendTrigger,
                          })}
                          className="flex-1 min-w-0 text-left"
                        />
                      )}

                      {draftRule.trigger.type === 'tapHoldKeyDown' && (
                        <div className="flex items-center gap-1 shrink-0">
                          <input
                            type="number"
                            min={1}
                            value={draftRule.trigger.timeoutMs}
                            onChange={(event) => setDraftRule({
                              ...draftRule,
                              trigger: {
                                ...draftRule.trigger,
                                timeoutMs: Math.max(1, Number.parseInt(event.target.value, 10) || 200),
                              },
                            })}
                            className="h-7 w-20 border border-app-border bg-app-bg px-2 text-[11px] font-mono text-app-text outline-none focus:border-app-primary"
                          />
                          <span className="text-[9px] text-app-muted">ms</span>
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                <section className="border border-app-border bg-app-bg">
                  <div className="h-8 px-2.5 flex items-center border-b border-app-border bg-app-surface/55">
                    <span className="text-[11px] font-semibold text-app-text">{t('ruleBuilder.tabs.conditions')}</span>
                    <button
                      type="button"
                      onClick={() => setDraftRule({
                        ...draftRule,
                        conditions: [...draftRule.conditions, { type: 'windowMatch', process: '', title: '' }],
                      })}
                      className="ml-auto h-6 px-2 border border-app-border bg-app-bg text-[10px] text-app-primary hover:bg-app-surface"
                    >
                      + {t('ruleBuilder.buttons.add_condition')}
                    </button>
                  </div>
                  <div className="p-2.5">
                    {draftRule.conditions.length === 0 ? (
                      <div className="py-1.5 text-[11px] text-app-muted">{t('ruleBuilder.hints.no_conditions_global')}</div>
                    ) : (
                      <div className="space-y-1.5">
                        {draftRule.conditions.map((condition, index) => (
                          <ConditionEditor
                            key={index}
                            condition={condition}
                            onChange={(nextCondition) => {
                              const conditions = [...draftRule.conditions];
                              conditions[index] = nextCondition;
                              setDraftRule({ ...draftRule, conditions });
                            }}
                            onRemove={() => setDraftRule({
                              ...draftRule,
                              conditions: draftRule.conditions.filter((_, itemIndex) => itemIndex !== index),
                            })}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </section>

                <section className="border border-app-border bg-app-bg">
                  <div className="h-8 px-2.5 flex items-center border-b border-app-border bg-app-surface/55">
                    <span className="text-[11px] font-semibold text-app-text">
                      {isTapHold ? t('ruleBuilder.tabs.tap_actions') : t('ruleBuilder.tabs.actions')}
                    </span>
                    <button
                      type="button"
                      onClick={() => setDraftRule({
                        ...draftRule,
                        actions: [...draftRule.actions, { type: 'typeText', text: '' }],
                      })}
                      className="ml-auto h-6 px-2 border border-app-border bg-app-bg text-[10px] text-app-primary hover:bg-app-surface"
                    >
                      + {t('ruleBuilder.buttons.add_action')}
                    </button>
                  </div>
                  <div className="p-2.5">
                    {draftRule.actions.length === 0 ? (
                      <div className="py-1.5 text-[11px] text-app-danger">{t('ruleBuilder.hints.must_have_action')}</div>
                    ) : (
                      <div className="space-y-1.5">
                        {draftRule.actions.map((action, index) => (
                          <ActionEditor
                            key={index}
                            action={action}
                            onChange={(nextAction) => {
                              const actions = [...draftRule.actions];
                              actions[index] = nextAction;
                              setDraftRule({ ...draftRule, actions });
                            }}
                            onRemove={() => setDraftRule({
                              ...draftRule,
                              actions: draftRule.actions.filter((_, itemIndex) => itemIndex !== index),
                            })}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </section>

                {isTapHold && (
                  <section className="border border-app-border bg-app-bg">
                    <div className="h-8 px-2.5 flex items-center border-b border-app-border bg-app-surface/55">
                      <span className="text-[11px] font-semibold text-app-text">{t('ruleBuilder.tabs.hold_actions')}</span>
                      <button
                        type="button"
                        onClick={() => setDraftRule({
                          ...draftRule,
                          holdActions: [...(draftRule.holdActions || []), { type: 'holdLayer', layerId: '' }],
                        })}
                        className="ml-auto h-6 px-2 border border-app-border bg-app-bg text-[10px] text-app-primary hover:bg-app-surface"
                      >
                        + {t('ruleBuilder.buttons.add_hold_action')}
                      </button>
                    </div>
                    <div className="p-2.5">
                      {!draftRule.holdActions || draftRule.holdActions.length === 0 ? (
                        <div className="py-1.5 text-[11px] text-app-muted">{t('ruleBuilder.hints.no_hold_actions')}</div>
                      ) : (
                        <div className="space-y-1.5">
                          {draftRule.holdActions.map((action, index) => (
                            <ActionEditor
                              key={index}
                              action={action}
                              onChange={(nextAction) => {
                                const holdActions = [...(draftRule.holdActions || [])];
                                holdActions[index] = nextAction;
                                setDraftRule({ ...draftRule, holdActions });
                              }}
                              onRemove={() => setDraftRule({
                                ...draftRule,
                                holdActions: (draftRule.holdActions || []).filter((_, itemIndex) => itemIndex !== index),
                              })}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </section>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={pendingIntent !== null}
        title={t('ruleBuilder.unsaved_title', 'Несохранённые изменения')}
        message={t('ruleBuilder.unsaved_message', 'Отбросить изменения и перейти дальше?')}
        confirmLabel={t('ruleBuilder.discard_changes', 'Отбросить')}
        danger
        onCancel={() => setPendingIntent(null)}
        onConfirm={() => {
          const intent = pendingIntent;
          setPendingIntent(null);
          if (intent) applyIntent(intent);
        }}
      />

      <ConfirmDialog
        open={ruleToDelete !== null}
        title={t('rules.delete_rule', 'Удалить правило')}
        message={t('rules.confirm_delete', 'Удалить выбранное правило?')}
        confirmLabel={t('profiles_menu.delete_btn', 'Удалить')}
        danger
        onCancel={() => setRuleToDelete(null)}
        onConfirm={async () => {
          const rule = ruleToDelete;
          setRuleToDelete(null);
          if (rule) await deleteRule(rule);
        }}
      />
    </>
  );
};
