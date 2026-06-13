import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useProfileStore } from '../store/profileStore';
import { useMouseRemapStore, MouseRemapRule } from '../store/mouseRemapStore';
import { useLayerStore } from '../store/layerStore';
import { useMacroStore } from '../store/macroStore';

const MOUSE_BUTTONS = [
  { value: 'left', labelKey: 'mouse_remapping.buttons.left', defaultLabel: '🖱️ Left Click' },
  { value: 'right', labelKey: 'mouse_remapping.buttons.right', defaultLabel: '🖱️ Right Click' },
  { value: 'middle', labelKey: 'mouse_remapping.buttons.middle', defaultLabel: '🖱️ Middle Click (Wheel)' },
  { value: 'xbutton1', labelKey: 'mouse_remapping.buttons.xbutton1', defaultLabel: '🔙 Side Button 1 (Back)' },
  { value: 'xbutton2', labelKey: 'mouse_remapping.buttons.xbutton2', defaultLabel: '🔜 Side Button 2 (Forward)' },
  { value: 'scroll up', labelKey: 'mouse_remapping.buttons.scroll_up', defaultLabel: '🔄 Scroll Up' },
  { value: 'scroll down', labelKey: 'mouse_remapping.buttons.scroll_down', defaultLabel: '🔄 Scroll Down' }
];

const COMMON_ACTIONS = [
  { value: 'volume_mute', labelKey: 'mouse_remapping.actions.volume_mute', defaultLabel: '🔇 Mute Volume' },
  { value: 'volume_up', labelKey: 'mouse_remapping.actions.volume_up', defaultLabel: '🔊 Volume +' },
  { value: 'volume_down', labelKey: 'mouse_remapping.actions.volume_down', defaultLabel: '🔉 Volume -' },
  { value: 'Ctrl+C', labelKey: 'mouse_remapping.actions.copy', defaultLabel: '📋 Copy (Ctrl+C)' },
  { value: 'Ctrl+V', labelKey: 'mouse_remapping.actions.paste', defaultLabel: '📥 Paste (Ctrl+V)' },
  { value: 'enter', labelKey: 'mouse_remapping.actions.enter', defaultLabel: '⌨️ Enter Key' },
  { value: 'escape', labelKey: 'mouse_remapping.actions.escape', defaultLabel: '⌨️ Escape Key' },
  { value: 'monitor_off', labelKey: 'mouse_remapping.actions.monitor_off', defaultLabel: '🔌 Turn Off Display' },
  { value: 'sleep', labelKey: 'mouse_remapping.actions.sleep', defaultLabel: '🌙 Sleep Mode' },
  { value: 'window_left', labelKey: 'mouse_remapping.actions.window_left', defaultLabel: '⬅️ Snap Window Left' },
  { value: 'window_right', labelKey: 'mouse_remapping.actions.window_right', defaultLabel: '➡️ Snap Window Right' },
  { value: 'window_center', labelKey: 'mouse_remapping.actions.window_center', defaultLabel: '🎯 Center Window' },
  { value: 'media_play', labelKey: 'mouse_remapping.actions.media_play', defaultLabel: '⏯️ Play / Pause' },
  { value: 'media_next', labelKey: 'mouse_remapping.actions.media_next', defaultLabel: '⏭️ Next Track' },
  { value: 'media_prev', labelKey: 'mouse_remapping.actions.media_prev', defaultLabel: '⏮️ Previous Track' },
];

export const MouseRemappingPage: React.FC = () => {
  const { t } = useTranslation();
  const activeProfileId = useProfileStore((state) => state.activeProfileId);
  const { rules, addRule, updateRule, deleteRule, loadRules } = useMouseRemapStore();
  const { layers, loadLayers } = useLayerStore();
  const { macros, loadMacros } = useMacroStore();

  const activeRules = rules.filter((r) => r.profileId === activeProfileId);
  const activeLayers = layers.filter((l) => l.profileId === activeProfileId);
  const activeMacros = macros.filter((m) => m.profileId === activeProfileId);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isCapturingMouse, setIsCapturingMouse] = useState(false);
  const [actionCategory, setActionCategory] = useState<'preset' | 'macro'>('preset');
  
  const [newRule, setNewRule] = useState({
    originalButton: MOUSE_BUTTONS[3].value,
    mappedAction: COMMON_ACTIONS[0].value,
    layerId: ''
  });

  // Mouse button capturing hook
  useEffect(() => {
    if (!isCapturingMouse) return;

    const handleMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      let buttonValue = '';
      if (e.button === 0) buttonValue = 'left';
      else if (e.button === 1) buttonValue = 'middle';
      else if (e.button === 2) buttonValue = 'right';
      else if (e.button === 3) buttonValue = 'xbutton1';
      else if (e.button === 4) buttonValue = 'xbutton2';

      if (buttonValue) {
        setNewRule(prev => ({ ...prev, originalButton: buttonValue }));
        setIsCapturingMouse(false);
      }
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const buttonValue = e.deltaY < 0 ? 'scroll up' : 'scroll down';
      setNewRule(prev => ({ ...prev, originalButton: buttonValue }));
      setIsCapturingMouse(false);
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    window.addEventListener('mousedown', handleMouseDown, { capture: true });
    window.addEventListener('wheel', handleWheel, { capture: true, passive: false });
    window.addEventListener('contextmenu', handleContextMenu, { capture: true });

    return () => {
      window.removeEventListener('mousedown', handleMouseDown, { capture: true });
      window.removeEventListener('wheel', handleWheel, { capture: true });
      window.removeEventListener('contextmenu', handleContextMenu, { capture: true });
    };
  }, [isCapturingMouse]);

  useEffect(() => {
    if (activeProfileId) {
      loadRules(activeProfileId);
      loadLayers(activeProfileId);
      loadMacros(activeProfileId);
    }
  }, [activeProfileId, loadRules, loadLayers, loadMacros]);

  // Listen to toolbar Add Rule event
  useEffect(() => {
    const handleAddRule = () => {
      setEditingId(null);
      setActionCategory('preset');
      setNewRule({
        originalButton: MOUSE_BUTTONS[3].value,
        mappedAction: COMMON_ACTIONS[0].value,
        layerId: ''
      });
      setIsModalOpen(true);
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


  const handleEdit = (rule: MouseRemapRule) => {
    const rawBtn = MOUSE_BUTTONS.find(b => b.value === rule.originalButton || b.labelKey === rule.originalButton)?.value || MOUSE_BUTTONS[3].value;
    const isMacro = rule.mappedAction.startsWith('macro:');
    
    setActionCategory(isMacro ? 'macro' : 'preset');
    setNewRule({
      originalButton: rawBtn,
      mappedAction: rule.mappedAction,
      layerId: rule.layerId || ''
    });
    setEditingId(rule.id);
    setIsModalOpen(true);
  };

  const handleSave = () => {
    if (activeProfileId) {
      if (editingId) {
        updateRule(editingId, {
          originalButton: newRule.originalButton,
          mappedAction: newRule.mappedAction,
          layerId: newRule.layerId || undefined,
        });
      } else {
        addRule({
          id: Date.now().toString(),
          profileId: activeProfileId,
          originalButton: newRule.originalButton,
          mappedAction: newRule.mappedAction,
          layerId: newRule.layerId || undefined,
        });
      }
      setIsModalOpen(false);
      setEditingId(null);
      setIsCapturingMouse(false);
      setNewRule({
        originalButton: MOUSE_BUTTONS[3].value,
        mappedAction: COMMON_ACTIONS[0].value,
        layerId: ''
      });
    }
  };

  return (
    <div className="space-y-4 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-app-text tracking-tight">{t('mouse_remapping.title')}</h2>
          <p className="text-xs text-app-muted">
            {t('mouse_remapping.description')}
          </p>
        </div>
        <button
          onClick={() => {
            setEditingId(null);
            setActionCategory('preset');
            setNewRule({
              originalButton: MOUSE_BUTTONS[3].value,
              mappedAction: COMMON_ACTIONS[0].value,
              layerId: ''
            });
            setIsModalOpen(true);
          }}
          className="px-3 py-1.5 bg-app-primary hover:bg-app-primary-hover text-white rounded-lg text-xs font-semibold shadow-lg shadow-app-primary/20 transition-all duration-200 cursor-pointer"
        >
          {t('mouse_remapping.add_rule')}
        </button>
      </div>

      {/* High-Density Rules Table */}
      <div className="overflow-x-auto border border-app-border rounded-xl bg-app-surface/20">
        <table className="w-full text-left border-collapse" style={{ fontSize: 'var(--table-font-size)' }}>
          <thead>
            <tr className="bg-app-surface/60 border-b border-app-border text-[10px] font-bold text-app-muted uppercase tracking-wider">
              <th className="px-4 py-2.5">{t('mouse_remapping.original_button_header', 'Trigger (Mouse)')}</th>
              <th className="px-4 py-2.5">{t('remapping.layer_header', 'Layer')}</th>
              <th className="px-4 py-2.5">{t('mouse_remapping.mapped_action_header', 'Action')}</th>
              <th className="px-4 py-2.5 text-right pr-6">{t('remapping.actions_header', 'Controls')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-app-border/40">
            {activeRules.map((rule) => {
              const btn = MOUSE_BUTTONS.find(b => b.value === rule.originalButton || b.labelKey === rule.originalButton);
              const layer = activeLayers.find(l => l.id === rule.layerId);

              let actionLabel = rule.mappedAction;
              if (rule.mappedAction.startsWith('macro:')) {
                const macroId = rule.mappedAction.split(':')[1];
                const macroObj = activeMacros.find(m => m.id === macroId);
                actionLabel = macroObj ? `🎬 ${t('mouse_remapping.macro_label')}: ${macroObj.name}` : `🎬 ${t('mouse_remapping.macro_label')}`;
              } else {
                const act = COMMON_ACTIONS.find(a => a.value === rule.mappedAction || a.labelKey === rule.mappedAction);
                actionLabel = act ? t(act.labelKey, act.defaultLabel) : rule.mappedAction;
              }

              return (
                <tr
                  key={rule.id}
                  className="hover:bg-app-surface-hover/30 transition-colors"
                >
                  <td className="px-4 font-medium" style={{ paddingTop: 'var(--table-row-padding)', paddingBottom: 'var(--table-row-padding)' }}>
                    <span className="px-2 py-0.5 rounded bg-app-surface-hover border border-app-border text-app-text text-[11px] font-semibold">
                      {btn ? t(btn.labelKey, btn.defaultLabel) : rule.originalButton}
                    </span>
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
                    <span className="px-2 py-0.5 rounded bg-app-primary/10 border border-app-primary/20 text-app-text text-[11px] font-semibold">
                      {actionLabel}
                    </span>
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
                  <span className="text-2xl block mb-2 opacity-30">🖱️</span>
                  {t('mouse_remapping.no_rules')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-app-bg/80 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
          <div className="bg-app-surface border border-app-border rounded-xl shadow-2xl w-[380px] overflow-hidden flex flex-col glow-primary">
            <div className="p-4 border-b border-app-border bg-app-bg/40 flex justify-between items-center">
              <h3 className="text-base font-bold text-app-text">{editingId ? t('mouse_remapping.edit_rule') : t('mouse_remapping.new_rule')}</h3>
              <button
                onClick={() => {
                  setIsModalOpen(false);
                  setEditingId(null);
                  setIsCapturingMouse(false);
                }}
                className="text-app-muted hover:text-app-text transition-colors text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-4 space-y-3">
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
                <label className="block text-[10px] font-bold text-app-muted uppercase tracking-wider mb-1.5">{t('mouse_remapping.mouse_trigger')}</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setIsCapturingMouse(true)}
                    className={`flex-1 py-2 px-3 text-xs font-semibold rounded-lg border transition-all duration-200 cursor-pointer ${
                      isCapturingMouse
                        ? 'bg-app-danger/10 border-app-danger text-app-danger animate-pulse font-bold'
                        : 'bg-app-surface-hover hover:bg-app-border border-app-border text-app-text'
                    }`}
                  >
                    {isCapturingMouse
                      ? t('mouse_remapping.recording_mouse')
                      : MOUSE_BUTTONS.find(b => b.value === newRule.originalButton)
                        ? t(MOUSE_BUTTONS.find(b => b.value === newRule.originalButton)!.labelKey, MOUSE_BUTTONS.find(b => b.value === newRule.originalButton)!.defaultLabel)
                        : newRule.originalButton}
                  </button>
                  
                  {!isCapturingMouse && (
                    <select
                      value={newRule.originalButton}
                      onChange={(e) => setNewRule(prev => ({ ...prev, originalButton: e.target.value }))}
                      className="w-32 bg-app-surface-hover border border-app-border text-xs text-app-text rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-app-primary"
                    >
                      {MOUSE_BUTTONS.map(btn => (
                        <option key={btn.value} value={btn.value}>{t(btn.labelKey, btn.defaultLabel)}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-app-muted uppercase tracking-wider mb-1.5">{t('remapping.action_type')}</label>
                <div className="flex gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => {
                       setActionCategory('preset');
                       setNewRule(prev => ({ ...prev, mappedAction: COMMON_ACTIONS[0].value }));
                    }}
                    className={`flex-1 py-1 px-2 text-xs font-semibold rounded-md border transition-colors cursor-pointer ${
                      actionCategory === 'preset'
                        ? 'bg-app-primary/20 border-app-primary text-app-text'
                        : 'bg-app-surface-hover border border-app-border text-app-muted hover:text-app-text'
                    }`}
                  >
                    {t('mouse_remapping.preset_category')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActionCategory('macro');
                      const firstMacro = activeMacros[0];
                      setNewRule(prev => ({
                        ...prev,
                        mappedAction: firstMacro ? `macro:${firstMacro.id}` : ''
                      }));
                    }}
                    className={`flex-1 py-1 px-2 text-xs font-semibold rounded-md border transition-colors cursor-pointer ${
                      actionCategory === 'macro'
                        ? 'bg-app-primary/20 border-app-primary text-app-text'
                        : 'bg-app-surface-hover border border-app-border text-app-muted hover:text-app-text'
                    }`}
                  >
                    {t('mouse_remapping.macro_category')}
                  </button>
                </div>

                {actionCategory === 'preset' ? (
                  <select
                    value={newRule.mappedAction}
                    onChange={(e) => setNewRule(prev => ({ ...prev, mappedAction: e.target.value }))}
                    className="w-full bg-app-surface-hover border border-app-border text-xs text-app-text rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-app-primary"
                  >
                    {COMMON_ACTIONS.map(act => (
                      <option key={act.value} value={act.value}>{t(act.labelKey, act.defaultLabel)}</option>
                    ))}
                  </select>
                ) : (
                  <select
                    value={newRule.mappedAction.startsWith('macro:') ? newRule.mappedAction : ''}
                    onChange={(e) => setNewRule(prev => ({ ...prev, mappedAction: e.target.value }))}
                    className="w-full bg-app-surface-hover border border-app-border text-xs text-app-text rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-app-primary"
                  >
                    <option value="">{t('mouse_remapping.select_macro')}</option>
                    {activeMacros.map(m => (
                      <option key={m.id} value={`macro:${m.id}`}>🎬 {m.name}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            <div className="p-3 border-t border-app-border bg-app-bg/40 flex justify-end gap-2">
              <button
                onClick={() => {
                  setIsModalOpen(false);
                  setEditingId(null);
                  setIsCapturingMouse(false);
                }}
                className="px-3 py-1.5 bg-app-surface-hover hover:bg-app-border border border-app-border text-xs font-semibold rounded-lg text-app-muted hover:text-app-text transition-colors cursor-pointer"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSave}
                className="px-3 py-1.5 bg-app-primary hover:bg-app-primary-hover text-white text-xs font-semibold rounded-lg shadow-lg shadow-app-primary/20 transition-all cursor-pointer"
              >
                {editingId ? t('common.save') : t('common.add')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};