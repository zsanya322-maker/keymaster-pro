import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useRemapStore, RemapRule } from '../store/remapStore';
import { useProfileStore } from '../store/profileStore';
import { useLayerStore } from '../store/layerStore';

interface NewRuleState {
  originalKey: string;
  actionType: 'key' | 'text' | 'launch' | 'system';
  mappedKey: string;
  textPayload: string;
  launchPayload: string;
  systemPayload: string;
  triggerType: 'normal' | 'long' | 'double';
  scopeType: 'global' | 'include' | 'exclude';
  scopeApps: string;
  layerId?: string;
}

const SYSTEM_ACTIONS = [
  { value: 'volume_up', labelKey: 'remapping.system_actions.volume_up', defaultLabel: '🔊 Volume Up' },
  { value: 'volume_down', labelKey: 'remapping.system_actions.volume_down', defaultLabel: '🔉 Volume Down' },
  { value: 'volume_mute', labelKey: 'remapping.system_actions.volume_mute', defaultLabel: '🔇 Mute Volume' },
  { value: 'monitor_off', labelKey: 'remapping.system_actions.monitor_off', defaultLabel: '🔌 Turn Off Display' },
  { value: 'sleep', labelKey: 'remapping.system_actions.sleep', defaultLabel: '🌙 Sleep Mode' },
  { value: 'screensaver', labelKey: 'remapping.system_actions.screensaver', defaultLabel: '🖼️ Screensaver' },
  { value: 'close_window', labelKey: 'remapping.system_actions.close_window', defaultLabel: '❌ Close Window' },
  { value: 'minimize_window', labelKey: 'remapping.system_actions.minimize_window', defaultLabel: '➖ Minimize Window' },
  { value: 'maximize_window', labelKey: 'remapping.system_actions.maximize_window', defaultLabel: '🔲 Maximize Window' },
  { value: 'window_left', labelKey: 'remapping.system_actions.window_left', defaultLabel: '⬅️ Snap Window Left' },
  { value: 'window_right', labelKey: 'remapping.system_actions.window_right', defaultLabel: '➡️ Snap Window Right' },
  { value: 'window_center', labelKey: 'remapping.system_actions.window_center', defaultLabel: '🎯 Center Window' },
  { value: 'media_play', labelKey: 'remapping.system_actions.media_play', defaultLabel: '⏯️ Play / Pause' },
  { value: 'media_next', labelKey: 'remapping.system_actions.media_next', defaultLabel: '⏭️ Next Track' },
  { value: 'media_prev', labelKey: 'remapping.system_actions.media_prev', defaultLabel: '⏮️ Previous Track' },
];

export const RemappingPage: React.FC = () => {
  const { t } = useTranslation();
  const activeProfileId = useProfileStore((state) => state.activeProfileId);
  const { rules, addRule, updateRule, deleteRule, loadRules } = useRemapStore();
  const { layers, loadLayers } = useLayerStore();

  const activeRules = rules.filter((r) => r.profileId === activeProfileId);
  const activeLayers = layers.filter((l) => l.profileId === activeProfileId);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<'trigger' | 'action' | 'scope'>('trigger');
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const [newRule, setNewRule] = useState<NewRuleState>({
    originalKey: '',
    actionType: 'key',
    mappedKey: '',
    textPayload: '',
    launchPayload: '',
    systemPayload: SYSTEM_ACTIONS[0].value,
    triggerType: 'normal',
    scopeType: 'global',
    scopeApps: '',
    layerId: '',
  });

  const [capturing, setCapturing] = useState<'original' | 'mapped' | null>(null);

  useEffect(() => {
    if (activeProfileId) {
      loadRules(activeProfileId);
      loadLayers(activeProfileId);
    }
  }, [activeProfileId, loadRules, loadLayers]);

  // Listen to toolbar Add Rule event
  useEffect(() => {
    const handleAddRule = () => {
      setEditingId(null);
      setIsModalOpen(true);
      setNewRule({
        originalKey: '',
        actionType: 'key',
        mappedKey: '',
        textPayload: '',
        launchPayload: '',
        systemPayload: SYSTEM_ACTIONS[0].value,
        triggerType: 'normal',
        scopeType: 'global',
        scopeApps: '',
        layerId: '',
      });
      setModalTab('trigger');
    };
    window.addEventListener('keymaster-add-rule', handleAddRule);
    return () => window.removeEventListener('keymaster-add-rule', handleAddRule);
  }, []);

  // Listen to menu Clear Mappings event
  useEffect(() => {
    const handleClearMappings = () => {
      activeRules.forEach((rule) => {
        deleteRule(rule.id);
      });
    };
    window.addEventListener('keymaster-clear-mappings', handleClearMappings);
    return () => window.removeEventListener('keymaster-clear-mappings', handleClearMappings);
  }, [activeRules, deleteRule]);

  useEffect(() => {
    if (!capturing) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      
      let keyLabel = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      if (e.code === 'Space') keyLabel = 'Space';
      if (e.code === 'ControlLeft' || e.code === 'ControlRight') keyLabel = 'Ctrl';
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keyLabel = 'Shift';
      if (e.code === 'AltLeft' || e.code === 'AltRight') keyLabel = 'Alt';
      if (e.code === 'MetaLeft' || e.code === 'MetaRight') keyLabel = 'Win';

      // Если зажаты модификаторы, создаем сочетание
      const modifiers = [];
      if (e.ctrlKey && keyLabel !== 'Ctrl') modifiers.push('Ctrl');
      if (e.shiftKey && keyLabel !== 'Shift') modifiers.push('Shift');
      if (e.altKey && keyLabel !== 'Alt') modifiers.push('Alt');
      if (e.metaKey && keyLabel !== 'Win') modifiers.push('Win');
      
      const finalKey = [...modifiers, keyLabel].join('+');

      if (capturing === 'original') setNewRule((prev) => ({ ...prev, originalKey: finalKey }));
      if (capturing === 'mapped') setNewRule((prev) => ({ ...prev, mappedKey: finalKey }));
      
      setCapturing(null);
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [capturing]);


  const handleEdit = (rule: RemapRule) => {
    let actionType: 'key' | 'text' | 'launch' | 'system' = 'key';
    let mappedKey = '';
    let textPayload = '';
    let launchPayload = '';
    let systemPayload = SYSTEM_ACTIONS[0].value;

    if (rule.mappedKey.startsWith('paste(')) {
      actionType = 'text';
      textPayload = rule.mappedKey.slice(6, -1);
    } else if (rule.mappedKey.startsWith('launch(')) {
      actionType = 'launch';
      launchPayload = rule.mappedKey.slice(7, -1);
    } else if (SYSTEM_ACTIONS.some(a => a.value === rule.mappedKey)) {
      actionType = 'system';
      systemPayload = rule.mappedKey;
    } else {
      actionType = 'key';
      mappedKey = rule.mappedKey;
    }

    setNewRule({
      originalKey: rule.originalKey,
      actionType,
      mappedKey,
      textPayload,
      launchPayload,
      systemPayload,
      triggerType: 'normal',
      scopeType: 'global',
      scopeApps: '',
      layerId: rule.layerId || '',
    });
    setEditingId(rule.id);
    setIsModalOpen(true);
  };

  const handleSave = () => {
    if (!activeProfileId || !newRule.originalKey) return;

    let displayAction = '';
    if (newRule.actionType === 'key') {
      displayAction = newRule.mappedKey || 'Key';
    } else if (newRule.actionType === 'text') {
      displayAction = `paste(${newRule.textPayload})`;
    } else if (newRule.actionType === 'launch') {
      displayAction = `launch(${newRule.launchPayload})`;
    } else if (newRule.actionType === 'system') {
      displayAction = newRule.systemPayload;
    }

    if (editingId) {
      updateRule(editingId, {
        originalKey: newRule.originalKey,
        mappedKey: displayAction,
        layerId: newRule.layerId || undefined,
      });
    } else {
      addRule({
        id: Date.now().toString(),
        profileId: activeProfileId,
        originalKey: newRule.originalKey,
        mappedKey: displayAction,
        layerId: newRule.layerId || undefined,
      });
    }

    setIsModalOpen(false);
    setEditingId(null);
    setNewRule({
      originalKey: '',
      actionType: 'key',
      mappedKey: '',
      textPayload: '',
      launchPayload: '',
      systemPayload: SYSTEM_ACTIONS[0].value,
      triggerType: 'normal',
      scopeType: 'global',
      scopeApps: '',
      layerId: '',
    });
    setModalTab('trigger');
  };

  const insertTemplate = (template: string) => {
    setNewRule(prev => ({
      ...prev,
      textPayload: prev.textPayload + template
    }));
  };

  return (
    <div className="space-y-4 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-app-text tracking-tight">{t('remapping.title')}</h2>
          <p className="text-xs text-app-muted">
            {t('remapping.description')}
          </p>
        </div>
        <button
          onClick={() => {
            setEditingId(null);
            setIsModalOpen(true);
          }}
          className="px-3 py-1.5 bg-app-primary hover:bg-app-primary-hover text-white rounded-lg text-xs font-semibold shadow-lg shadow-app-primary/20 transition-all duration-200 cursor-pointer"
        >
          {t('remapping.add_rule')}
        </button>
      </div>

      {/* High-Density Rules Table */}
      <div className="overflow-x-auto border border-app-border rounded-xl bg-app-surface/20">
        <table className="w-full text-left border-collapse" style={{ fontSize: 'var(--table-font-size)' }}>
          <thead>
            <tr className="bg-app-surface/60 border-b border-app-border text-[10px] font-bold text-app-muted uppercase tracking-wider">
              <th className="px-4 py-2.5">{t('remapping.original_key_header', 'Trigger (Key)')}</th>
              <th className="px-4 py-2.5">{t('remapping.layer_header', 'Layer')}</th>
              <th className="px-4 py-2.5">{t('remapping.mapped_action_header', 'Action')}</th>
              <th className="px-4 py-2.5 text-right pr-6">{t('remapping.actions_header', 'Controls')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-app-border/40">
            {activeRules.map((rule) => {
              const isText = rule.mappedKey.startsWith('paste(') || rule.mappedKey.startsWith('Вставить:');
              const isLaunch = rule.mappedKey.startsWith('launch(') || rule.mappedKey.startsWith('Запуск:');
              const isSystem = SYSTEM_ACTIONS.some(a => rule.mappedKey === a.value);
              const layer = activeLayers.find(l => l.id === rule.layerId);

              let displayLabel = rule.mappedKey;
              if (rule.mappedKey.startsWith('paste(')) {
                const txt = rule.mappedKey.slice(6, -1);
                displayLabel = `${t('remapping.paste_label')}: "${txt.slice(0, 15)}${txt.length > 15 ? '...' : ''}"`;
              } else if (rule.mappedKey.startsWith('launch(')) {
                const path = rule.mappedKey.slice(7, -1);
                displayLabel = `${t('remapping.launch_label')}: ${path.split('\\').pop()}`;
              } else if (isSystem) {
                const act = SYSTEM_ACTIONS.find(a => a.value === rule.mappedKey);
                displayLabel = act ? t(act.labelKey, act.defaultLabel) : rule.mappedKey;
              }

              return (
                <tr
                  key={rule.id}
                  className="hover:bg-app-surface-hover/30 transition-colors"
                >
                  <td className="px-4 font-medium" style={{ paddingTop: 'var(--table-row-padding)', paddingBottom: 'var(--table-row-padding)' }}>
                    <span className="keycap font-mono">{rule.originalKey}</span>
                  </td>
                  <td className="px-4 text-app-muted font-medium" style={{ paddingTop: 'var(--table-row-padding)', paddingBottom: 'var(--table-row-padding)' }}>
                    {layer ? (
                      <span className="px-1.5 py-0.5 rounded bg-app-primary/15 border border-app-primary/20 text-app-primary text-[10px] font-bold">
                        {layer.name}
                      </span>
                    ) : (
                      <span className="text-[11px] opacity-40">—</span>
                    )}
                  </td>
                  <td className="px-4" style={{ paddingTop: 'var(--table-row-padding)', paddingBottom: 'var(--table-row-padding)' }}>
                    {isText ? (
                      <span className="px-2 py-0.5 rounded-md bg-app-accent/10 border border-app-accent/20 text-app-accent text-[11px] font-semibold">
                        {displayLabel}
                      </span>
                    ) : isLaunch ? (
                      <span className="px-2 py-0.5 rounded-md bg-app-warning/10 border border-app-warning/20 text-app-warning text-[11px] font-semibold">
                        {displayLabel}
                      </span>
                    ) : isSystem ? (
                      <span className="px-2 py-0.5 rounded-md bg-app-danger/10 border border-app-danger/20 text-app-danger text-[11px] font-semibold">
                        {displayLabel}
                      </span>
                    ) : (
                      <span className="keycap font-mono">{displayLabel}</span>
                    )}
                  </td>
                  <td className="px-4 text-right pr-6" style={{ paddingTop: 'var(--table-row-padding)', paddingBottom: 'var(--table-row-padding)' }}>
                    <div className="flex justify-end gap-1.5">
                      <button
                        onClick={() => handleEdit(rule)}
                        className="p-1 text-app-muted hover:text-app-primary hover:bg-app-primary/10 rounded border border-transparent hover:border-app-primary/20 text-xs cursor-pointer"
                        title={t('common.edit')}
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => deleteRule(rule.id)}
                        className="p-1 text-app-muted hover:text-app-danger hover:bg-app-danger/10 rounded border border-transparent hover:border-app-danger/20 text-xs cursor-pointer"
                        title={t('common.delete')}
                      >
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {activeRules.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-app-muted text-xs">
                  <span className="text-2xl block mb-2 opacity-30">⌨️</span>
                  {t('remapping.no_rules')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modern Modal Overlay */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-app-bg/80 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
          <div className="bg-app-surface border border-app-border rounded-xl shadow-2xl w-[440px] overflow-hidden flex flex-col glow-primary">
            {/* Modal Header */}
            <div className="p-4 border-b border-app-border bg-app-bg/40 flex justify-between items-center">
              <h3 className="text-base font-bold text-app-text">{editingId ? t('remapping.edit_rule') : t('remapping.new_rule')}</h3>
              <button
                onClick={() => {
                  setIsModalOpen(false);
                  setEditingId(null);
                }}
                className="text-app-muted hover:text-app-text transition-colors text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Modal Tabs */}
            <div className="flex border-b border-app-border bg-app-bg/20 text-[10px] font-bold">
              <button
                onClick={() => setModalTab('trigger')}
                className={`flex-1 py-2 text-center border-b-2 transition-all ${
                  modalTab === 'trigger' ? 'border-app-primary text-app-text bg-app-primary/5' : 'border-transparent text-app-muted hover:text-app-text'
                }`}
              >
                {t('remapping.trigger_tab')}
              </button>
              <button
                onClick={() => setModalTab('action')}
                className={`flex-1 py-2 text-center border-b-2 transition-all ${
                  modalTab === 'action' ? 'border-app-primary text-app-text bg-app-primary/5' : 'border-transparent text-app-muted hover:text-app-text'
                }`}
              >
                {t('remapping.action_tab')}
              </button>
              <button
                onClick={() => setModalTab('scope')}
                className={`flex-1 py-2 text-center border-b-2 transition-all ${
                  modalTab === 'scope' ? 'border-app-primary text-app-text bg-app-primary/5' : 'border-transparent text-app-muted hover:text-app-text'
                }`}
              >
                {t('remapping.conditions_tab')}
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 space-y-4 flex-1 min-h-[260px] max-h-[380px] overflow-y-auto">
              
              {/* TAB 1: TRIGGER DETAILS */}
              {modalTab === 'trigger' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold text-app-muted uppercase tracking-wider mb-1.5">{t('remapping.layer_context')}</label>
                    <select
                       value={newRule.layerId || ''}
                       onChange={(e) => setNewRule(prev => ({ ...prev, layerId: e.target.value }))}
                       className="w-full bg-app-surface-hover border border-app-border text-xs text-app-text rounded-lg p-2 focus:ring-1 focus:ring-app-primary focus:outline-none"
                    >
                      <option value="">{t('remapping.base_layer')}</option>
                      {activeLayers.map(l => (
                        <option key={l.id} value={l.id}>{l.name} ({t('layers.priority_text')} {l.priority})</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-app-muted uppercase tracking-wider mb-1.5">{t('remapping.press_key_prompt')}</label>
                    <button
                      onClick={() => setCapturing('original')}
                      className={`w-full px-3 py-3 border border-dashed rounded-lg text-center text-xs transition-all cursor-pointer ${
                        capturing === 'original'
                          ? 'border-app-primary bg-app-primary/10 text-app-text animate-pulse'
                          : newRule.originalKey
                          ? 'border-app-border bg-app-surface-hover text-app-text font-semibold'
                          : 'border-app-border hover:border-app-primary/30 hover:bg-app-surface-hover/30 text-app-muted'
                      }`}
                    >
                      {capturing === 'original' ? t('remapping.recording') : newRule.originalKey || t('remapping.recording_prompt')}
                    </button>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-app-muted uppercase tracking-wider mb-1.5">{t('remapping.trigger_type')}</label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['normal', 'long', 'double'] as const).map(type => (
                        <button
                          key={type}
                          onClick={() => setNewRule(prev => ({ ...prev, triggerType: type }))}
                          className={`py-1.5 px-2.5 rounded-md border text-xs font-semibold transition-all cursor-pointer ${
                            newRule.triggerType === type
                              ? 'bg-app-primary/20 border-app-primary text-app-text'
                              : 'bg-app-surface-hover/30 border-app-border text-app-muted hover:border-app-border hover:text-app-text'
                          }`}
                        >
                          {type === 'normal' ? t('remapping.trigger_normal') : type === 'long' ? t('remapping.trigger_long') : t('remapping.trigger_double')}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: ACTION DETAILS */}
              {modalTab === 'action' && (
                <div className="space-y-3">
                  {/* Action Type Select */}
                  <div>
                    <label className="block text-[10px] font-bold text-app-muted uppercase tracking-wider mb-1.5">{t('remapping.action_type')}</label>
                    <select
                      value={newRule.actionType}
                      onChange={(e) => setNewRule(prev => ({ ...prev, actionType: e.target.value as any }))}
                      className="w-full bg-app-surface-hover border border-app-border text-xs text-app-text rounded-lg p-2 focus:ring-1 focus:ring-app-primary focus:outline-none"
                    >
                      <option value="key">{t('remapping.action_remap')}</option>
                      <option value="text">{t('remapping.action_text')}</option>
                      <option value="launch">{t('remapping.action_launch')}</option>
                      <option value="system">{t('remapping.action_system')}</option>
                    </select>
                  </div>

                  {/* Dynamic Action Fields */}
                  {newRule.actionType === 'key' && (
                    <div>
                      <label className="block text-[10px] font-bold text-app-muted uppercase tracking-wider mb-1.5">{t('remapping.new_action_key')}</label>
                      <button
                        onClick={() => setCapturing('mapped')}
                        className={`w-full px-3 py-3 border border-dashed rounded-lg text-center text-xs transition-all cursor-pointer ${
                          capturing === 'mapped'
                            ? 'border-app-primary bg-app-primary/10 text-app-text animate-pulse'
                            : newRule.mappedKey
                            ? 'border-app-border bg-app-surface-hover text-app-text font-semibold'
                            : 'border-app-border hover:border-app-primary/30 hover:bg-app-surface-hover/30 text-app-muted'
                        }`}
                      >
                        {capturing === 'mapped' ? t('remapping.recording') : newRule.mappedKey || t('remapping.recording_prompt')}
                      </button>
                    </div>
                  )}

                  {newRule.actionType === 'text' && (
                    <div className="space-y-2.5">
                      <div>
                        <label className="block text-[10px] font-bold text-app-muted uppercase tracking-wider mb-1.5">{t('remapping.text_payload_label')}</label>
                        <textarea
                          rows={3}
                          value={newRule.textPayload}
                          onChange={(e) => setNewRule(prev => ({ ...prev, textPayload: e.target.value }))}
                          placeholder={t('remapping.text_payload_placeholder')}
                          className="w-full bg-app-surface-hover border border-app-border text-xs text-app-text rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-app-primary"
                        />
                      </div>
                      
                      {/* Templates Placeholders */}
                      <div>
                        <span className="block text-[9px] text-app-muted font-bold uppercase tracking-wider mb-1">{t('remapping.insert_template')}</span>
                        <div className="flex flex-wrap gap-1.5">
                          {['%date%', '%time%', '%clipboard%', '%selected_text%'].map(tpl => (
                            <button
                              key={tpl}
                              type="button"
                              onClick={() => insertTemplate(tpl)}
                              className="text-[9px] bg-app-border hover:bg-app-primary/20 hover:text-app-text text-app-muted px-1.5 py-0.5 rounded border border-app-border font-mono transition-colors cursor-pointer"
                            >
                              {tpl}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {newRule.actionType === 'launch' && (
                    <div>
                      <label className="block text-[10px] font-bold text-app-muted uppercase tracking-wider mb-1.5">{t('remapping.launch_path_label')}</label>
                      <input
                        type="text"
                        value={newRule.launchPayload}
                        onChange={(e) => setNewRule(prev => ({ ...prev, launchPayload: e.target.value }))}
                        placeholder={t('remapping.launch_path_placeholder')}
                        className="w-full bg-app-surface-hover border border-app-border text-xs text-app-text rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-app-primary"
                      />
                    </div>
                  )}

                  {newRule.actionType === 'system' && (
                    <div>
                      <label className="block text-[10px] font-bold text-app-muted uppercase tracking-wider mb-1.5">{t('remapping.system_action_label')}</label>
                      <select
                        value={newRule.systemPayload}
                        onChange={(e) => setNewRule(prev => ({ ...prev, systemPayload: e.target.value }))}
                        className="w-full bg-app-surface-hover border border-app-border text-xs text-app-text rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-app-primary"
                      >
                        {SYSTEM_ACTIONS.map(act => (
                           <option key={act.value} value={act.value}>{t(act.labelKey, act.defaultLabel)}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: SCOPE DETAILS */}
              {modalTab === 'scope' && (
                <div className="space-y-3 animate-fade-in">
                  <div>
                    <label className="block text-[10px] font-bold text-app-muted uppercase tracking-wider mb-1.5">{t('remapping.scope_label')}</label>
                    <div className="space-y-1.5 text-xs">
                      {[
                        { value: 'global', label: t('remapping.scope_global') },
                        { value: 'include', label: t('remapping.scope_include') },
                        { value: 'exclude', label: t('remapping.scope_exclude') }
                      ].map(scope => (
                        <label key={scope.value} className="flex items-center gap-2 cursor-pointer">
                           <input
                            type="radio"
                            name="scope_radio"
                            checked={newRule.scopeType === scope.value}
                            onChange={() => setNewRule(prev => ({ ...prev, scopeType: scope.value as any }))}
                            className="text-app-primary focus:ring-app-primary bg-app-surface-hover border-app-border"
                          />
                          <span className="text-app-text">{scope.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {newRule.scopeType !== 'global' && (
                    <div>
                      <label className="block text-[10px] font-bold text-app-muted uppercase tracking-wider mb-1.5">{t('remapping.exe_list_label')}</label>
                      <textarea
                        rows={2}
                        value={newRule.scopeApps}
                        onChange={(e) => setNewRule(prev => ({ ...prev, scopeApps: e.target.value }))}
                        placeholder={t('remapping.exe_list_placeholder')}
                        className="w-full bg-app-surface-hover border border-app-border text-xs text-app-text rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-app-primary"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3 border-t border-app-border bg-app-bg/40 flex justify-between">
              {modalTab === 'trigger' ? (
                <div />
              ) : (
                <button
                  onClick={() => setModalTab(modalTab === 'scope' ? 'action' : 'trigger')}
                  className="px-3 py-1.5 bg-app-surface-hover hover:bg-app-border border border-app-border text-xs font-semibold rounded-lg text-app-muted hover:text-app-text transition-colors cursor-pointer"
                >
                  {t('remapping.back')}
                </button>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setIsModalOpen(false);
                    setEditingId(null);
                  }}
                  className="px-3 py-1.5 bg-app-surface-hover hover:bg-app-border border border-app-border text-xs font-semibold rounded-lg text-app-muted hover:text-app-text transition-colors cursor-pointer"
                >
                  {t('common.cancel')}
                </button>
                
                {modalTab !== 'scope' ? (
                  <button
                    onClick={() => setModalTab(modalTab === 'trigger' ? 'action' : 'scope')}
                    disabled={!newRule.originalKey}
                    className="px-3 py-1.5 bg-app-primary hover:bg-app-primary-hover text-white text-xs font-semibold rounded-lg shadow-lg shadow-app-primary/20 transition-all disabled:opacity-50 cursor-pointer"
                  >
                    {t('remapping.next')}
                  </button>
                ) : (
                  <button
                    onClick={handleSave}
                    disabled={!newRule.originalKey}
                    className="px-3 py-1.5 bg-app-primary hover:bg-app-primary-hover text-white text-xs font-semibold rounded-lg shadow-lg shadow-app-primary/20 transition-all disabled:opacity-50 cursor-pointer"
                  >
                    {t('remapping.save_rule')}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};