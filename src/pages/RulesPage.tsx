import React, { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import {
  FileText,
  Keyboard,
  ListPlus,
  Mouse,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react';
import { useProfileStore } from '../store/profileStore';
import { useKeyMasterStore } from '../store/keyMasterStore';
import { useAppStore } from '../store/appStore';
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

const inputClass = 'h-7 border border-app-border bg-app-bg px-2 text-[11px] text-app-text outline-none focus:border-app-primary';
const selectClass = `${inputClass} cursor-pointer`;

function EditorSection({
  title,
  action,
  children,
}: {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border border-app-border bg-app-bg">
      <div className="h-7 px-2 flex items-center border-b border-app-border bg-app-surface/45">
        <span className="text-[10px] font-semibold text-app-text">{title}</span>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div>{children}</div>
    </section>
  );
}

function PropertyRow({
  label,
  children,
  hint,
  last = false,
}: {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  last?: boolean;
}) {
  return (
    <div className={`grid grid-cols-[116px_minmax(0,1fr)] min-h-9 ${last ? '' : 'border-b border-app-border/55'}`}>
      <div className="px-2 flex items-center border-r border-app-border/55 bg-app-surface/15 text-[10px] text-app-muted">
        {label}
      </div>
      <div className="px-1.5 py-1 flex items-center gap-2 min-w-0">
        {children}
        {hint && <span className="text-[9px] text-app-muted truncate">{hint}</span>}
      </div>
    </div>
  );
}

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

function formatTriggerType(trigger: FrontendTrigger, t: TFunction): string {
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

function formatConditionLabel(condition: FrontendCondition, t: TFunction): string {
  switch (condition.type) {
    case 'layerActive':
      return `${t('ruleBuilder.condition_types.layerActive')}: ${condition.layerId || '—'}`;
    case 'virtualDesktop':
      return `${t('ruleBuilder.condition_types.virtualDesktop')}: ${condition.id}`;
    case 'windowMatch': {
      const parts: string[] = [];
      if (condition.process) parts.push(condition.process);
      if (condition.title) parts.push(`“${condition.title}”`);
      return `${t('ruleBuilder.condition_types.windowMatch')}: ${parts.length ? parts.join(' / ') : '—'}`;
    }
  }
}

function formatActionLabel(action: FrontendAction, t: TFunction): string {
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

function formatRuleSummary(rule: FrontendRule, t: TFunction): string {
  const firstAction = rule.actions[0];
  if (!firstAction) return '—';
  const first = formatActionLabel(firstAction, t);
  return rule.actions.length > 1 ? `${first}  +${rule.actions.length - 1}` : first;
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
  if (type === 'tapHoldKeyDown') return { ...rule, trigger: { type: 'tapHoldKeyDown', code: 0, timeoutMs: 200 } };
  if (type === 'typedText') return { ...rule, trigger: { type: 'typedText', sequence: '' } };
  if (type === 'keyDown') return { ...rule, trigger: { type: 'keyDown', code: 0 } };
  if (type === 'keyUp') return { ...rule, trigger: { type: 'keyUp', code: 0 } };
  if (type === 'mouseDown') return { ...rule, trigger: { type: 'mouseDown', code: 1 } };
  return { ...rule, trigger: { type: 'mouseUp', code: 1 } };
}

export const RulesPage: React.FC<RulesPageProps> = ({ mode = 'all' }) => {
  const { t } = useTranslation();
  const { profiles, activeProfileId, saveProfile } = useProfileStore();
  const daemonConnected = useAppStore((state) => state.daemonConnected);
  const setRulesDirty = useKeyMasterStore((state) => state.setRulesDirty);
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) || null;

  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [draftRule, setDraftRule] = useState<FrontendRule | null>(null);
  const [baseline, setBaseline] = useState('');
  const [isNewRule, setIsNewRule] = useState(false);
  const [query, setQuery] = useState('');
  const [pendingIntent, setPendingIntent] = useState<EditorIntent | null>(null);
  const [ruleToDelete, setRuleToDelete] = useState<FrontendRule | null>(null);
  const [saving, setSaving] = useState(false);

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

  useEffect(() => {
    setRulesDirty(isDirty);
  }, [isDirty, setRulesDirty]);

  useEffect(() => () => {
    useKeyMasterStore.getState().setRulesDirty(false);
  }, []);

  const openExistingRule = (rule: FrontendRule) => {
    const copy = structuredClone(rule);
    setSelectedRuleId(rule.id);
    setDraftRule(copy);
    setBaseline(JSON.stringify(copy));
    setIsNewRule(false);
  };

  const clearEditor = () => {
    setSelectedRuleId(null);
    setDraftRule(null);
    setBaseline('');
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

    const rule = useProfileStore.getState().profiles
      .find((profile) => profile.id === useProfileStore.getState().activeProfileId)
      ?.rules.find((item) => item.id === intent.id);
    if (rule) openExistingRule(rule);
  };

  const requestIntent = (intent: EditorIntent) => {
    if (saving) return;
    if (isDirty) setPendingIntent(intent);
    else applyIntent(intent);
  };

  useEffect(() => {
    setQuery('');
    setPendingIntent(null);
    setRuleToDelete(null);

    const state = useProfileStore.getState();
    const profile = state.profiles.find((item) => item.id === state.activeProfileId);
    const first = profile?.rules.find((rule) => matchesMode(rule, mode));
    if (first) openExistingRule(first);
    else clearEditor();
  }, [activeProfileId, mode]);

  const handleSaveRule = async () => {
    if (!activeProfile || !draftRule || draftRule.actions.length === 0 || saving) return;

    const savedRule = structuredClone(draftRule);
    const nextRules = isNewRule
      ? [...activeProfile.rules, savedRule]
      : activeProfile.rules.map((rule) => rule.id === savedRule.id ? savedRule : rule);

    setSaving(true);
    try {
      const saved = await saveProfile({ ...activeProfile, rules: nextRules });
      if (!saved) return;

      setSelectedRuleId(savedRule.id);
      setDraftRule(savedRule);
      setBaseline(JSON.stringify(savedRule));
      setIsNewRule(false);
    } finally {
      setSaving(false);
    }
  };

  const resetDraft = () => {
    if (saving) return;

    if (isNewRule) {
      const first = modeRules[0];
      if (first) openExistingRule(first);
      else clearEditor();
      return;
    }

    const original = activeProfile?.rules.find((rule) => rule.id === selectedRuleId);
    if (original) openExistingRule(original);
  };

  const deleteRule = async (rule: FrontendRule) => {
    if (!activeProfile || saving) return;
    const nextRules = activeProfile.rules.filter((item) => item.id !== rule.id);

    setSaving(true);
    try {
      const saved = await saveProfile({ ...activeProfile, rules: nextRules });
      if (!saved) return;

      const nextVisible = nextRules.filter((item) => matchesMode(item, mode));
      const next = nextVisible[0] ?? null;
      if (next) openExistingRule(next);
      else clearEditor();
    } finally {
      setSaving(false);
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
      } else if (command === 'delete' && draftRule && !isNewRule && !saving) {
        setRuleToDelete(draftRule);
      }
    };

    window.addEventListener(RULE_COMMAND_EVENT, onCommand);
    return () => window.removeEventListener(RULE_COMMAND_EVENT, onCommand);
  }, [draftRule, isNewRule, isDirty, saving]);

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
    ? t('nav.macros')
    : mode === 'text'
      ? t('nav.text')
      : t('rules.title');

  const saveDisabled = !draftRule
    || draftRule.actions.length === 0
    || saving
    || (!isDirty && !isNewRule);
  const isTapHold = draftRule?.trigger.type === 'tapHoldKeyDown';

  return (
    <>
      <div className="h-full min-h-0 flex bg-app-bg overflow-hidden">
        <section className="w-[34%] min-w-[300px] max-w-[455px] flex flex-col border-r border-app-border bg-app-bg min-h-0">
          <div className="h-9 px-2.5 flex items-center border-b border-app-border bg-app-surface/35 shrink-0">
            <h2 className="text-[11px] font-semibold text-app-text">{viewTitle}</h2>
            {query && (
              <span className="ml-2 text-[9px] text-app-primary truncate">
                “{query}”
              </span>
            )}
            <span className="ml-auto text-[9px] font-mono text-app-muted">{filteredRules.length}/{modeRules.length}</span>
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
                  disabled={saving}
                  onClick={() => requestIntent({ type: 'select', id: rule.id })}
                  className={`w-full min-h-[44px] px-2 py-1 text-left border-b border-app-border/50 flex items-center gap-1.5 transition-colors disabled:opacity-60 ${
                    selected
                      ? 'bg-app-primary/10 shadow-[inset_2px_0_0_var(--color-primary)]'
                      : 'hover:bg-app-surface-hover/30'
                  }`}
                >
                  <TriggerIcon size={13} className={`shrink-0 ${invalidMouse ? 'text-app-danger' : selected ? 'text-app-primary' : 'text-app-muted'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 min-w-0 leading-4">
                      <strong className="text-[11px] font-semibold text-app-text truncate">
                        {rule.name?.trim() || formatTriggerKey(rule.trigger)}
                      </strong>
                      <span className="text-[9px] text-app-muted shrink-0">{formatTriggerType(rule.trigger, t)}</span>
                    </span>
                    <span className={`block text-[9px] leading-4 truncate ${invalidMouse ? 'text-app-danger' : 'text-app-muted'}`}>
                      {invalidMouse
                        ? t('rules.invalid_mouse_code')
                        : `${formatTriggerKey(rule.trigger)}  →  ${formatRuleSummary(rule, t)}`}
                    </span>
                  </span>
                </button>
              );
            })}

            {filteredRules.length === 0 && (
              <div className="py-7 px-4 text-center text-[10px] text-app-muted">
                {query ? t('rules.search_empty') : t('rules.empty_state')}
              </div>
            )}

            <button
              type="button"
              disabled={saving}
              onClick={() => requestIntent({ type: 'new' })}
              className="w-full h-8 px-2 text-left text-[10px] text-app-muted hover:text-app-primary hover:bg-app-surface/45 flex items-center gap-1.5 border-b border-app-border/45 disabled:opacity-40"
            >
              <ListPlus size={12} />
              {t('rules.add_rule')}
            </button>
          </div>

          <div className="h-7 px-2.5 flex items-center border-t border-app-border bg-app-surface/25 text-[9px] text-app-muted shrink-0">
            {t('rules.total_rules')}: <strong className="ml-1 font-mono text-app-text">{modeRules.length}</strong>
          </div>
        </section>

        <section className="flex-1 min-w-0 flex flex-col bg-app-bg min-h-0">
          <div className="h-9 px-2.5 flex items-center border-b border-app-border bg-app-surface/35 shrink-0">
            <h2 className="text-[11px] font-semibold text-app-text">
              {isNewRule ? t('ruleBuilder.modal.create_title') : t('rules.editor_title')}
            </h2>
            {isDirty && <span className="ml-2 text-[9px] text-app-warning">● {t('rules.unsaved')}</span>}
            {saving && <span className="ml-2 text-[9px] text-app-primary">{t('common.saving', { defaultValue: 'Сохранение…' })}</span>}

            {draftRule && (
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={resetDraft}
                  disabled={saving || (!isDirty && !isNewRule)}
                  className="h-6 px-2 inline-flex items-center gap-1 border border-app-border bg-app-bg text-[9px] text-app-text hover:bg-app-surface disabled:opacity-30"
                >
                  <RotateCcw size={10} />
                  {t('ruleBuilder.buttons.cancel')}
                </button>
                {!isNewRule && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setRuleToDelete(draftRule)}
                    className="h-6 w-6 inline-flex items-center justify-center border border-app-border bg-app-bg text-app-muted hover:bg-app-surface hover:text-app-danger disabled:opacity-30"
                    title={t('rules.delete_rule')}
                  >
                    <Trash2 size={11} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleSaveRule()}
                  disabled={saveDisabled}
                  className="h-6 px-2.5 inline-flex items-center gap-1 border border-app-primary bg-app-primary text-[9px] font-semibold text-white hover:bg-app-primary-hover disabled:opacity-30"
                >
                  <Save size={10} />
                  {t('ruleBuilder.buttons.save_rule')}
                </button>
              </div>
            )}
          </div>

          {!draftRule ? (
            <div className="flex-1 flex items-center justify-center text-[10px] text-app-muted">
              {t('rules.select_rule_hint')}
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto p-2">
              <div className="w-full max-w-[840px] space-y-2">
                <EditorSection title={t('ruleBuilder.tabs.name')}>
                  <PropertyRow label={t('common.name', { defaultValue: 'Название' })}>
                    <input
                      type="text"
                      value={draftRule.name || ''}
                      disabled={saving}
                      onChange={(event) => setDraftRule({ ...draftRule, name: event.target.value })}
                      placeholder={t('ruleBuilder.placeholders.name')}
                      className={`${inputClass} w-full max-w-[520px] disabled:opacity-50`}
                    />
                  </PropertyRow>
                  <PropertyRow
                    label={t('ruleBuilder.priority')}
                    hint={t('ruleBuilder.priority_hint')}
                    last
                  >
                    <input
                      type="number"
                      value={draftRule.priority}
                      disabled={saving}
                      onChange={(event) => setDraftRule({ ...draftRule, priority: Number.parseInt(event.target.value, 10) || 0 })}
                      className={`${inputClass} w-24 font-mono disabled:opacity-50`}
                    />
                  </PropertyRow>
                </EditorSection>

                <EditorSection title={t('ruleBuilder.tabs.trigger')}>
                  <div className="p-1.5 flex items-center gap-1.5 min-w-0">
                    <select
                      value={draftRule.trigger.type}
                      disabled={saving}
                      onChange={(event) => setDraftRule(changeTriggerType(draftRule, event.target.value as FrontendTrigger['type']))}
                      className={`${selectClass} w-[190px] shrink-0 bg-app-surface/35 disabled:opacity-50`}
                    >
                      <option value="keyDown">{t('ruleBuilder.trigger_types.keyDown')}</option>
                      <option value="keyUp">{t('ruleBuilder.trigger_types.keyUp')}</option>
                      <option value="mouseDown">{t('ruleBuilder.trigger_types.mouseDown')}</option>
                      <option value="mouseUp">{t('ruleBuilder.trigger_types.mouseUp')}</option>
                      <option value="tapHoldKeyDown">{t('ruleBuilder.trigger_types.tapHoldKeyDown')}</option>
                      <option value="typedText">{t('ruleBuilder.trigger_types.typedText')}</option>
                    </select>

                    {draftRule.trigger.type === 'typedText' ? (
                      <input
                        type="text"
                        value={draftRule.trigger.sequence}
                        disabled={saving}
                        onChange={(event) => setDraftRule({ ...draftRule, trigger: { type: 'typedText', sequence: event.target.value } })}
                        placeholder={t('ruleBuilder.placeholders.sequence')}
                        className={`${inputClass} flex-1 min-w-0 max-w-[520px] disabled:opacity-50`}
                      />
                    ) : (
                      <KeyPicker
                        value={draftRule.trigger.code}
                        onChange={(code) => setDraftRule({
                          ...draftRule,
                          trigger: { ...draftRule.trigger, code } as FrontendTrigger,
                        })}
                        className="flex-1 min-w-0 max-w-[520px] text-left"
                      />
                    )}

                    {draftRule.trigger.type === 'tapHoldKeyDown' && (
                      <div className="flex items-center gap-1 shrink-0">
                        <input
                          type="number"
                          min={1}
                          value={draftRule.trigger.timeoutMs}
                          disabled={saving}
                          onChange={(event) => {
                            const timeoutMs = Math.max(1, Number.parseInt(event.target.value, 10) || 200);
                            setDraftRule((current) => {
                              if (!current || current.trigger.type !== 'tapHoldKeyDown') return current;
                              return {
                                ...current,
                                trigger: {
                                  type: 'tapHoldKeyDown',
                                  code: current.trigger.code,
                                  timeoutMs,
                                },
                              };
                            });
                          }}
                          className={`${inputClass} w-20 font-mono disabled:opacity-50`}
                        />
                        <span className="text-[9px] text-app-muted">ms</span>
                      </div>
                    )}
                  </div>
                </EditorSection>

                <EditorSection
                  title={t('ruleBuilder.tabs.conditions')}
                  action={(
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => setDraftRule({
                        ...draftRule,
                        conditions: [...draftRule.conditions, { type: 'windowMatch', process: '', title: '' }],
                      })}
                      className="h-5 px-1.5 text-[9px] text-app-primary hover:bg-app-surface disabled:opacity-40"
                    >
                      + {t('ruleBuilder.buttons.add_condition')}
                    </button>
                  )}
                >
                  <div className="p-1.5">
                    {draftRule.conditions.length === 0 ? (
                      <div className="h-7 px-1 flex items-center text-[10px] text-app-muted">
                        {t('ruleBuilder.hints.no_conditions_global')}
                      </div>
                    ) : (
                      <div className={`space-y-1 ${saving ? 'pointer-events-none opacity-60' : ''}`}>
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
                </EditorSection>

                <EditorSection
                  title={isTapHold ? t('ruleBuilder.tabs.tap_actions') : t('ruleBuilder.tabs.actions')}
                  action={(
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => setDraftRule({
                        ...draftRule,
                        actions: [...draftRule.actions, { type: 'typeText', text: '' }],
                      })}
                      className="h-5 px-1.5 text-[9px] text-app-primary hover:bg-app-surface disabled:opacity-40"
                    >
                      + {t('ruleBuilder.buttons.add_action')}
                    </button>
                  )}
                >
                  <div className="p-1.5">
                    {draftRule.actions.length === 0 ? (
                      <div className="h-7 px-1 flex items-center text-[10px] text-app-danger">
                        {t('ruleBuilder.hints.must_have_action')}
                      </div>
                    ) : (
                      <div className={`space-y-1 ${saving ? 'pointer-events-none opacity-60' : ''}`}>
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
                </EditorSection>

                {isTapHold && (
                  <EditorSection
                    title={t('ruleBuilder.tabs.hold_actions')}
                    action={(
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => setDraftRule({
                          ...draftRule,
                          holdActions: [...(draftRule.holdActions || []), { type: 'holdLayer', layerId: '' }],
                        })}
                        className="h-5 px-1.5 text-[9px] text-app-primary hover:bg-app-surface disabled:opacity-40"
                      >
                        + {t('ruleBuilder.buttons.add_hold_action')}
                      </button>
                    )}
                  >
                    <div className="p-1.5">
                      {!draftRule.holdActions || draftRule.holdActions.length === 0 ? (
                        <div className="h-7 px-1 flex items-center text-[10px] text-app-muted">
                          {t('ruleBuilder.hints.no_hold_actions')}
                        </div>
                      ) : (
                        <div className={`space-y-1 ${saving ? 'pointer-events-none opacity-60' : ''}`}>
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
                  </EditorSection>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={pendingIntent !== null}
        title={t('ruleBuilder.unsaved_title')}
        message={t('ruleBuilder.unsaved_message')}
        confirmLabel={t('ruleBuilder.discard_changes')}
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
        title={t('rules.delete_rule')}
        message={t('rules.confirm_delete')}
        confirmLabel={t('profiles_menu.delete_btn')}
        danger
        onCancel={() => { if (!saving) setRuleToDelete(null); }}
        onConfirm={async () => {
          const rule = ruleToDelete;
          if (!rule) return;
          const beforeId = rule.id;
          await deleteRule(rule);
          const stillExists = useProfileStore.getState().profiles
            .find((profile) => profile.id === useProfileStore.getState().activeProfileId)
            ?.rules.some((item) => item.id === beforeId);
          if (!stillExists) setRuleToDelete(null);
        }}
      />
    </>
  );
};
