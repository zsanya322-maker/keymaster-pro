import React, { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import {
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
import { TextPromptDialog } from '../components/TextPromptDialog';
import { RuleTreePanel, type FolderMoveTarget, type RuleMoveTarget } from '../components/rules/RuleTreePanel';
import type { FrontendAction, FrontendCondition, FrontendRule, FrontendTrigger, RuleFolder } from '../lib/types';
import { formatKeyChord, vkToName } from '../lib/keyCodes';
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
  | { type: 'new'; folderId?: string | null };

type FolderPrompt =
  | { type: 'create'; parentId: string | null }
  | { type: 'rename'; folder: RuleFolder }
  | null;

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
      return formatKeyChord({ code: trigger.code, modifiers: trigger.modifiers });
    case 'mouseDown':
    case 'mouseUp':
    case 'tapHoldKeyDown':
      return vkToName(trigger.code);
    case 'mouseWheel': {
      const arrow = { up: '↑', down: '↓', left: '←', right: '→' }[trigger.direction];
      return `Wheel ${arrow}`;
    }
    case 'mouseDoubleClick':
      return `2× ${vkToName(trigger.code)}`;
    case 'mouseMove':
      return 'Mouse move';
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
    case 'mouseWheel': return t('ruleBuilder.trigger_types.mouseWheel');
    case 'mouseDoubleClick': return t('ruleBuilder.trigger_types.mouseDoubleClick');
    case 'mouseMove': return t('ruleBuilder.trigger_types.mouseMove');
    case 'tapHoldKeyDown': return t('rules.trigger_tap_hold');
    case 'typedText': return t('rules.trigger_typed');
  }
}

function formatConditionLabel(condition: FrontendCondition, t: TFunction): string {
  switch (condition.type) {
    case 'layerActive':
      return `${t('ruleBuilder.condition_types.layerActive')}: ${condition.layerId || '—'}`;
    case 'virtualDesktop':
      return `${t('ruleBuilder.condition_types.virtualDesktop')}: ${condition.id}`;
    case 'contextMatch': {
      const parts = [condition.process, condition.path, condition.title, condition.className, condition.virtualDesktopId, condition.monitorId].filter(Boolean)
      const geometry = [condition.minWidth, condition.maxWidth, condition.minHeight, condition.maxHeight].some(value => value !== undefined)
        ? `${condition.minWidth ?? '—'}..${condition.maxWidth ?? '—'} × ${condition.minHeight ?? '—'}..${condition.maxHeight ?? '—'}`
        : ''
      if (geometry) parts.push(geometry)
      if (condition.fullscreen !== undefined) parts.push(condition.fullscreen ? 'fullscreen' : 'windowed')
      return `Context (${condition.mode.toUpperCase()}): ${parts.length ? parts.join(' / ') : '—'}`
    }
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
    case 'remapKey':
      return `${t('ruleBuilder.action_types.remapKey')} → ${formatKeyChord({ code: action.code, modifiers: action.modifiers })}`;
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

function matchesMode(rule: FrontendRule, mode: RulesViewMode): boolean {
  if (mode === 'all') return true;
  if (mode === 'macros') return rule.actions.some((action) => action.type === 'runMacro');
  return rule.trigger.type === 'typedText' || rule.actions.some((action) => action.type === 'typeText');
}

function baseRule(order = 0): Pick<FrontendRule, 'id' | 'name' | 'holdActions' | 'conditions' | 'priority' | 'enabled' | 'folderId' | 'order'> {
  return {
    id: crypto.randomUUID(),
    name: '',
    holdActions: [],
    conditions: [],
    priority: 0,
    enabled: true,
    folderId: null,
    order,
  };
}

function makeNewRule(mode: RulesViewMode, order = 0): FrontendRule {
  if (mode === 'macros') {
    return {
      ...baseRule(order),
      trigger: { type: 'keyDown', code: 0, modifiers: 0 },
      actions: [{ type: 'runMacro', steps: [], playback: { speed: 1, repeatCount: 1, repeatWhileHeld: false } }],
    };
  }

  if (mode === 'text') {
    return {
      ...baseRule(order),
      trigger: { type: 'typedText', sequence: '' },
      actions: [{ type: 'typeText', text: '' }],
    };
  }

  return {
    ...baseRule(order),
    trigger: { type: 'keyDown', code: 0, modifiers: 0 },
    actions: [],
  };
}

function changeTriggerType(rule: FrontendRule, type: FrontendTrigger['type']): FrontendRule {
  if (type === 'tapHoldKeyDown') return { ...rule, trigger: { type: 'tapHoldKeyDown', code: 0, timeoutMs: 200 } };
  if (type === 'typedText') return { ...rule, trigger: { type: 'typedText', sequence: '' } };
  if (type === 'keyDown') return { ...rule, trigger: { type: 'keyDown', code: 0, modifiers: 0 } };
  if (type === 'keyUp') return { ...rule, trigger: { type: 'keyUp', code: 0, modifiers: 0 } };
  if (type === 'mouseDown') return { ...rule, trigger: { type: 'mouseDown', code: 1 } };
  if (type === 'mouseUp') return { ...rule, trigger: { type: 'mouseUp', code: 1 } };
  if (type === 'mouseWheel') return { ...rule, trigger: { type: 'mouseWheel', direction: 'up' } };
  if (type === 'mouseDoubleClick') return { ...rule, trigger: { type: 'mouseDoubleClick', code: 1 } };
  return { ...rule, trigger: { type: 'mouseMove', minDistance: 24, cooldownMs: 120 } };
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
  const [folderPrompt, setFolderPrompt] = useState<FolderPrompt>(null);
  const [folderToDelete, setFolderToDelete] = useState<RuleFolder | null>(null);
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

  const openNewRule = (folderId: string | null = null) => {
    const siblingCount = activeProfile?.rules.filter((rule) => (rule.folderId ?? null) === folderId).length ?? 0;
    const next = { ...makeNewRule(mode, siblingCount), folderId };
    setSelectedRuleId(null);
    setDraftRule(next);
    setBaseline(JSON.stringify(next));
    setIsNewRule(true);
  };

  const applyIntent = (intent: EditorIntent) => {
    if (intent.type === 'new') {
      openNewRule(intent.folderId ?? null);
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

  const syncDraftMetadata = (nextRules: FrontendRule[]) => {
    if (!draftRule) return;
    const persisted = nextRules.find((rule) => rule.id === draftRule.id);
    if (!persisted) return;

    const patch = {
      enabled: persisted.enabled,
      folderId: persisted.folderId ?? null,
      order: persisted.order,
    };
    setDraftRule((current) => current?.id === persisted.id ? { ...current, ...patch } : current);
    if (baseline) {
      try {
        const parsed = JSON.parse(baseline) as FrontendRule;
        if (parsed.id === persisted.id) setBaseline(JSON.stringify({ ...parsed, ...patch }));
      } catch {
        // Baseline is internal JSON generated by this page; ignore impossible corruption.
      }
    }
  };

  const saveStructure = async (nextRules: FrontendRule[], nextFolders: RuleFolder[]) => {
    if (!activeProfile || saving) return false;
    setSaving(true);
    try {
      const saved = await saveProfile({ ...activeProfile, rules: nextRules, folders: nextFolders });
      if (saved) syncDraftMetadata(nextRules);
      return saved;
    } finally {
      setSaving(false);
    }
  };

  const createFolder = async (name: string, parentId: string | null) => {
    if (!activeProfile) return;
    const order = activeProfile.folders.filter((folder) => (folder.parentId ?? null) === parentId).length;
    const folder: RuleFolder = {
      id: crypto.randomUUID(),
      name,
      parentId,
      order,
    };
    if (await saveStructure(activeProfile.rules, [...activeProfile.folders, folder])) {
      setFolderPrompt(null);
    }
  };

  const renameFolder = async (folder: RuleFolder, name: string) => {
    if (!activeProfile) return;
    const nextFolders = activeProfile.folders.map((item) => item.id === folder.id ? { ...item, name } : item);
    if (await saveStructure(activeProfile.rules, nextFolders)) setFolderPrompt(null);
  };

  const deleteFolder = async (folder: RuleFolder) => {
    if (!activeProfile) return;
    const parentId = folder.parentId ?? null;
    const nextRules = activeProfile.rules.map((rule) =>
      (rule.folderId ?? null) === folder.id ? { ...rule, folderId: parentId } : rule,
    );
    const nextFolders = activeProfile.folders
      .filter((item) => item.id !== folder.id)
      .map((item) => (item.parentId ?? null) === folder.id ? { ...item, parentId } : item);
    if (await saveStructure(nextRules, nextFolders)) setFolderToDelete(null);
  };

  const duplicateRule = async (rule: FrontendRule) => {
    if (!activeProfile) return;
    const folderId = rule.folderId ?? null;
    const siblings = activeProfile.rules.filter((item) => (item.folderId ?? null) === folderId);
    const copy: FrontendRule = {
      ...structuredClone(rule),
      id: crypto.randomUUID(),
      name: rule.name?.trim()
        ? `${rule.name} ${t('rules.tree.copy_suffix', { defaultValue: '— копия' })}`
        : `${formatTriggerKey(rule.trigger)} ${t('rules.tree.copy_suffix', { defaultValue: '— копия' })}`,
      order: Math.max(-1, ...siblings.map((item) => item.order)) + 1,
    };
    await saveStructure([...activeProfile.rules, copy], activeProfile.folders);
  };

  const toggleRule = async (rule: FrontendRule) => {
    if (!activeProfile) return;
    const nextRules = activeProfile.rules.map((item) => item.id === rule.id ? { ...item, enabled: !item.enabled } : item);
    await saveStructure(nextRules, activeProfile.folders);
  };

  const moveRule = async (ruleId: string, target: RuleMoveTarget) => {
    if (!activeProfile) return;
    const moving = activeProfile.rules.find((rule) => rule.id === ruleId);
    if (!moving || target.beforeRuleId === ruleId) return;

    const sourceFolderId = moving.folderId ?? null;
    const targetFolderId = target.folderId ?? null;
    const updated = new Map<string, FrontendRule>();

    const sourceSiblings = activeProfile.rules
      .filter((rule) => rule.id !== ruleId && (rule.folderId ?? null) === sourceFolderId)
      .sort((a, b) => a.order - b.order);
    sourceSiblings.forEach((rule, index) => updated.set(rule.id, { ...rule, order: index }));

    const targetSiblings = activeProfile.rules
      .filter((rule) => rule.id !== ruleId && (rule.folderId ?? null) === targetFolderId)
      .sort((a, b) => a.order - b.order);
    let insertAt = target.beforeRuleId
      ? targetSiblings.findIndex((rule) => rule.id === target.beforeRuleId)
      : targetSiblings.length;
    if (insertAt < 0) insertAt = targetSiblings.length;
    targetSiblings.splice(insertAt, 0, { ...moving, folderId: targetFolderId });
    targetSiblings.forEach((rule, index) => updated.set(rule.id, { ...rule, folderId: targetFolderId, order: index }));

    const nextRules = activeProfile.rules.map((rule) => updated.get(rule.id) ?? rule);
    await saveStructure(nextRules, activeProfile.folders);
  };

  const moveFolder = async (folderId: string, target: FolderMoveTarget) => {
    if (!activeProfile || target.parentId === folderId || target.beforeFolderId === folderId) return;
    const moving = activeProfile.folders.find((folder) => folder.id === folderId);
    if (!moving) return;

    // Reject cycles: the target parent may not be a descendant of the moving folder.
    const byId = new Map(activeProfile.folders.map((folder) => [folder.id, folder]));
    let cursor = target.parentId;
    while (cursor) {
      if (cursor === folderId) return;
      cursor = byId.get(cursor)?.parentId ?? null;
    }

    const sourceParent = moving.parentId ?? null;
    const targetParent = target.parentId ?? null;
    const updated = new Map<string, RuleFolder>();

    const sourceSiblings = activeProfile.folders
      .filter((folder) => folder.id !== folderId && (folder.parentId ?? null) === sourceParent)
      .sort((a, b) => a.order - b.order);
    sourceSiblings.forEach((folder, index) => updated.set(folder.id, { ...folder, order: index }));

    const targetSiblings = activeProfile.folders
      .filter((folder) => folder.id !== folderId && (folder.parentId ?? null) === targetParent)
      .sort((a, b) => a.order - b.order);
    let insertAt = target.beforeFolderId
      ? targetSiblings.findIndex((folder) => folder.id === target.beforeFolderId)
      : targetSiblings.length;
    if (insertAt < 0) insertAt = targetSiblings.length;
    targetSiblings.splice(insertAt, 0, { ...moving, parentId: targetParent });
    targetSiblings.forEach((folder, index) => updated.set(folder.id, { ...folder, parentId: targetParent, order: index }));

    const nextFolders = activeProfile.folders.map((folder) => updated.get(folder.id) ?? folder);
    await saveStructure(activeProfile.rules, nextFolders);
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
        requestIntent({ type: 'new', folderId: null });
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
        <RuleTreePanel
          title={viewTitle}
          rules={filteredRules}
          folders={activeProfile.folders}
          selectedRuleId={isNewRule ? null : selectedRuleId}
          query={query}
          saving={saving}
          onSelectRule={(rule) => requestIntent({ type: 'select', id: rule.id })}
          onCreateRule={(folderId) => requestIntent({ type: 'new', folderId })}
          onCreateFolder={(parentId) => setFolderPrompt({ type: 'create', parentId })}
          onRenameFolder={(folder) => setFolderPrompt({ type: 'rename', folder })}
          onDeleteFolder={(folder) => setFolderToDelete(folder)}
          onDuplicateRule={(rule) => void duplicateRule(rule)}
          onToggleRule={(rule) => void toggleRule(rule)}
          onDeleteRule={(rule) => setRuleToDelete(rule)}
          onMoveRule={(ruleId, target) => void moveRule(ruleId, target)}
          onMoveFolder={(folderId, target) => void moveFolder(folderId, target)}
        />

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
                  <PropertyRow label={t('common.name', { defaultValue: 'Название' })} last>
                    <input
                      type="text"
                      value={draftRule.name || ''}
                      disabled={saving}
                      onChange={(event) => setDraftRule({ ...draftRule, name: event.target.value })}
                      placeholder={t('ruleBuilder.placeholders.name')}
                      className={`${inputClass} w-full max-w-[520px] disabled:opacity-50`}
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
                      <option value="mouseWheel">{t('ruleBuilder.trigger_types.mouseWheel')}</option>
                      <option value="mouseDoubleClick">{t('ruleBuilder.trigger_types.mouseDoubleClick')}</option>
                      <option value="mouseMove">{t('ruleBuilder.trigger_types.mouseMove')}</option>
                      <option value="tapHoldKeyDown">{t('ruleBuilder.trigger_types.tapHoldKeyDown')}</option>
                      <option value="typedText">{t('ruleBuilder.trigger_types.typedText')}</option>
                    </select>

                    {draftRule.trigger.type === 'typedText' && (
                      <input
                        type="text"
                        value={draftRule.trigger.sequence}
                        disabled={saving}
                        onChange={(event) => setDraftRule({ ...draftRule, trigger: { type: 'typedText', sequence: event.target.value } })}
                        placeholder={t('ruleBuilder.placeholders.sequence')}
                        className={`${inputClass} flex-1 min-w-0 max-w-[520px] disabled:opacity-50`}
                      />
                    )}

                    {(draftRule.trigger.type === 'keyDown' || draftRule.trigger.type === 'keyUp') && (
                      <KeyPicker
                        value={{ code: draftRule.trigger.code, modifiers: draftRule.trigger.modifiers }}
                        onChange={(chord) => setDraftRule({
                          ...draftRule,
                          trigger: {
                            type: draftRule.trigger.type === 'keyUp' ? 'keyUp' : 'keyDown',
                            code: chord.code,
                            modifiers: chord.modifiers,
                          },
                        })}
                        className="flex-1 min-w-0 max-w-[520px] text-left"
                      />
                    )}

                    {draftRule.trigger.type === 'tapHoldKeyDown' && (
                      <>
                        <KeyPicker
                          value={{ code: draftRule.trigger.code, modifiers: 0 }}
                          allowModifiers={false}
                          onChange={(chord) => setDraftRule({
                            ...draftRule,
                            trigger: {
                              type: 'tapHoldKeyDown',
                              code: chord.code,
                              timeoutMs: draftRule.trigger.type === 'tapHoldKeyDown'
                                ? draftRule.trigger.timeoutMs
                                : 200,
                            },
                          })}
                          className="flex-1 min-w-0 max-w-[420px] text-left"
                        />
                        <details className="relative shrink-0">
                          <summary className="list-none h-7 px-2 inline-flex items-center border border-app-border bg-app-bg text-[9px] text-app-muted hover:bg-app-surface cursor-pointer">
                            {t('common.advanced', { defaultValue: 'Доп.' })}
                          </summary>
                          <div className="absolute z-30 right-0 top-8 w-48 border border-app-border bg-app-bg shadow-lg p-2">
                            <div className="text-[9px] text-app-muted mb-1">{t('ruleBuilder.priority_hint', { defaultValue: 'Tap-Hold timeout, ms' })}</div>
                            <input
                              type="number"
                              min={1}
                              value={draftRule.trigger.timeoutMs}
                              disabled={saving}
                              onChange={(event) => {
                                const timeoutMs = Math.max(1, Number.parseInt(event.target.value, 10) || 200);
                                setDraftRule((current) => {
                                  if (!current || current.trigger.type !== 'tapHoldKeyDown') return current;
                                  return { ...current, trigger: { ...current.trigger, timeoutMs } };
                                });
                              }}
                              className={`${inputClass} w-full font-mono disabled:opacity-50`}
                            />
                          </div>
                        </details>
                      </>
                    )}

                    {(draftRule.trigger.type === 'mouseDown' || draftRule.trigger.type === 'mouseUp' || draftRule.trigger.type === 'mouseDoubleClick') && (
                      <select
                        value={draftRule.trigger.code}
                        disabled={saving}
                        onChange={(event) => {
                          const code = Number.parseInt(event.target.value, 10) || 1;
                          const type = draftRule.trigger.type;
                          setDraftRule({
                            ...draftRule,
                            trigger: type === 'mouseUp'
                              ? { type: 'mouseUp', code }
                              : type === 'mouseDoubleClick'
                                ? { type: 'mouseDoubleClick', code }
                                : { type: 'mouseDown', code },
                          });
                        }}
                        className={`${selectClass} flex-1 min-w-0 max-w-[520px] disabled:opacity-50`}
                      >
                        <option value="1">{t('ruleBuilder.action_options.mouse_left')}</option>
                        <option value="2">{t('ruleBuilder.action_options.mouse_right')}</option>
                        <option value="3">{t('ruleBuilder.action_options.mouse_middle')}</option>
                        <option value="4">{t('ruleBuilder.action_options.mouse_x1')}</option>
                        <option value="5">{t('ruleBuilder.action_options.mouse_x2')}</option>
                      </select>
                    )}

                    {draftRule.trigger.type === 'mouseWheel' && (
                      <select
                        value={draftRule.trigger.direction}
                        disabled={saving}
                        onChange={(event) => setDraftRule({
                          ...draftRule,
                          trigger: {
                            type: 'mouseWheel',
                            direction: event.target.value as 'up' | 'down' | 'left' | 'right',
                          },
                        })}
                        className={`${selectClass} flex-1 min-w-0 max-w-[520px] disabled:opacity-50`}
                      >
                        <option value="up">{t('ruleBuilder.mouse_options.wheel_up')}</option>
                        <option value="down">{t('ruleBuilder.mouse_options.wheel_down')}</option>
                        <option value="left">{t('ruleBuilder.mouse_options.wheel_left')}</option>
                        <option value="right">{t('ruleBuilder.mouse_options.wheel_right')}</option>
                      </select>
                    )}

                    {draftRule.trigger.type === 'mouseMove' && (
                      <>
                        <div className="h-7 flex-1 min-w-0 max-w-[420px] px-2 inline-flex items-center border border-app-border bg-app-surface/20 text-[10px] text-app-muted">
                          {t('ruleBuilder.mouse_options.move_hint')}
                        </div>
                        <details className="relative shrink-0">
                          <summary className="list-none h-7 px-2 inline-flex items-center border border-app-border bg-app-bg text-[9px] text-app-muted hover:bg-app-surface cursor-pointer">
                            {t('common.advanced', { defaultValue: 'Доп.' })}
                          </summary>
                          <div className="absolute z-30 right-0 top-8 w-52 border border-app-border bg-app-bg shadow-lg p-2 space-y-2">
                            <label className="block">
                              <span className="block mb-1 text-[9px] text-app-muted">{t('ruleBuilder.mouse_options.move_distance')}</span>
                              <input
                                type="number"
                                min={1}
                                max={2000}
                                value={draftRule.trigger.minDistance}
                                disabled={saving}
                                onChange={(event) => {
                                  const minDistance = Math.max(1, Number.parseInt(event.target.value, 10) || 24);
                                  setDraftRule((current) => current?.trigger.type === 'mouseMove'
                                    ? { ...current, trigger: { ...current.trigger, minDistance } }
                                    : current);
                                }}
                                className={`${inputClass} w-full font-mono disabled:opacity-50`}
                              />
                            </label>
                            <label className="block">
                              <span className="block mb-1 text-[9px] text-app-muted">{t('ruleBuilder.mouse_options.move_cooldown')}</span>
                              <input
                                type="number"
                                min={0}
                                max={60000}
                                value={draftRule.trigger.cooldownMs}
                                disabled={saving}
                                onChange={(event) => {
                                  const cooldownMs = Math.max(0, Number.parseInt(event.target.value, 10) || 0);
                                  setDraftRule((current) => current?.trigger.type === 'mouseMove'
                                    ? { ...current, trigger: { ...current.trigger, cooldownMs } }
                                    : current);
                                }}
                                className={`${inputClass} w-full font-mono disabled:opacity-50`}
                              />
                            </label>
                          </div>
                        </details>
                      </>
                    )}
                  </div>
                </EditorSection>

                <details className="border border-app-border bg-app-bg group">
                  <summary className="h-7 px-2 flex items-center cursor-pointer select-none bg-app-surface/25 text-[10px] text-app-muted hover:text-app-text">
                    {t('common.advanced', { defaultValue: 'Дополнительно' })}
                    <span className="ml-auto text-[9px] font-mono">
                      {draftRule.conditions.length > 0 ? `${draftRule.conditions.length} cond.` : ''}
                    </span>
                  </summary>
                  <div className="border-t border-app-border">
                    <PropertyRow label={t('ruleBuilder.priority')} hint={t('ruleBuilder.priority_hint')}>
                      <input
                        type="number"
                        value={draftRule.priority}
                        disabled={saving}
                        onChange={(event) => setDraftRule({ ...draftRule, priority: Number.parseInt(event.target.value, 10) || 0 })}
                        className={`${inputClass} w-24 font-mono disabled:opacity-50`}
                      />
                    </PropertyRow>
                    <PropertyRow label={t('common.enabled', { defaultValue: 'Включено' })} last>
                      <input
                        type="checkbox"
                        checked={draftRule.enabled}
                        disabled={saving}
                        onChange={(event) => setDraftRule({ ...draftRule, enabled: event.target.checked })}
                      />
                    </PropertyRow>

                    <div className="border-t border-app-border">
                      <div className="h-7 px-2 flex items-center bg-app-surface/15 text-[10px] text-app-muted">
                        {t('ruleBuilder.tabs.conditions')}
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => setDraftRule({
                            ...draftRule,
                            conditions: [...draftRule.conditions, { type: 'windowMatch', process: '', title: '' }],
                          })}
                          className="ml-auto h-5 px-1.5 text-[9px] text-app-primary hover:bg-app-surface disabled:opacity-40"
                        >
                          + {t('ruleBuilder.buttons.add_condition')}
                        </button>
                      </div>
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
                    </div>
                  </div>
                </details>

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

      <TextPromptDialog
        open={folderPrompt !== null}
        title={folderPrompt?.type === 'rename'
          ? t('rules.tree.rename_folder', { defaultValue: 'Переименовать папку' })
          : t('rules.tree.new_folder', { defaultValue: 'Новая папка' })}
        label={t('common.name', { defaultValue: 'Название' })}
        initialValue={folderPrompt?.type === 'rename' ? folderPrompt.folder.name : ''}
        placeholder={t('rules.tree.folder_name', { defaultValue: 'Название папки' })}
        confirmLabel={folderPrompt?.type === 'rename'
          ? t('common.save', { defaultValue: 'Сохранить' })
          : t('common.create', { defaultValue: 'Создать' })}
        cancelLabel={t('common.cancel', { defaultValue: 'Отмена' })}
        onCancel={() => { if (!saving) setFolderPrompt(null); }}
        onConfirm={async (name) => {
          const prompt = folderPrompt;
          if (!prompt) return;
          if (prompt.type === 'rename') await renameFolder(prompt.folder, name);
          else await createFolder(name, prompt.parentId);
        }}
      />

      <ConfirmDialog
        open={folderToDelete !== null}
        title={t('rules.tree.delete_folder', { defaultValue: 'Удалить папку' })}
        message={t('rules.tree.delete_folder_hint', { defaultValue: 'Правила и подпапки не удалятся — они будут перемещены на уровень выше.' })}
        confirmLabel={t('profiles_menu.delete_btn')}
        danger
        onCancel={() => { if (!saving) setFolderToDelete(null); }}
        onConfirm={async () => {
          const folder = folderToDelete;
          if (folder) await deleteFolder(folder);
        }}
      />
    </>
  );
};