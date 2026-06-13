import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useProfileStore } from '../store/profileStore';
import { useLayerStore, Layer } from '../store/layerStore';
import { Layers, HelpCircle, Edit2, Trash2, Check, X } from 'lucide-react';

export const LayersPage: React.FC = () => {
  const { t } = useTranslation();
  const activeProfileId = useProfileStore((state) => state.activeProfileId);
  const { layers, addLayer, deleteLayer, updateLayer, loadLayers } = useLayerStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    name: string;
    priority: number;
    triggerType: 'hotkey' | 'process' | 'window_title' | 'none';
    triggerValue: string;
  }>({
    name: '',
    priority: 10,
    triggerType: 'none',
    triggerValue: '',
  });

  const [capturingLayerId, setCapturingLayerId] = useState<string | null>(null);

  useEffect(() => {
    if (activeProfileId) loadLayers(activeProfileId);
  }, [activeProfileId, loadLayers]);

  useEffect(() => {
    if (!capturingLayerId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      let keyLabel = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      if (e.code === 'Space') keyLabel = 'Space';
      if (e.code === 'ControlLeft' || e.code === 'ControlRight') keyLabel = 'Ctrl';
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keyLabel = 'Shift';
      if (e.code === 'AltLeft' || e.code === 'AltRight') keyLabel = 'Alt';
      if (e.code === 'MetaLeft' || e.code === 'MetaRight') keyLabel = 'Win';

      const modifiers = [];
      if (e.ctrlKey && keyLabel !== 'Ctrl') modifiers.push('Ctrl');
      if (e.shiftKey && keyLabel !== 'Shift') modifiers.push('Shift');
      if (e.altKey && keyLabel !== 'Alt') modifiers.push('Alt');
      if (e.metaKey && keyLabel !== 'Win') modifiers.push('Win');

      const finalKey = [...modifiers, keyLabel].join('+');

      setEditForm((prev) => ({ ...prev, triggerValue: finalKey }));
      setCapturingLayerId(null);
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [capturingLayerId]);

  const activeLayers = layers
    .filter((l) => l.profileId === activeProfileId)
    .sort((a, b) => b.priority - a.priority);

  const handleAdd = () => {
    if (activeProfileId) {
      const newId = Date.now().toString();
      const newLayer: Layer = {
        id: newId,
        profileId: activeProfileId,
        name: t('layers.new_layer_default'),
        priority: 10,
        triggerType: 'none',
        triggerValue: '',
      };
      addLayer(newLayer);
      setEditingId(newId);
      setEditForm({
        name: newLayer.name,
        priority: newLayer.priority,
        triggerType: newLayer.triggerType,
        triggerValue: newLayer.triggerValue,
      });
    }
  };

  const handleStartEdit = (layer: Layer) => {
    setEditingId(layer.id);
    setEditForm({
      name: layer.name,
      priority: layer.priority,
      triggerType: layer.triggerType,
      triggerValue: layer.triggerValue,
    });
  };

  const handleSaveEdit = (id: string) => {
    updateLayer(id, editForm);
    setEditingId(null);
  };

  return (
    <div className="space-y-4 max-w-6xl animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-app-text tracking-tight">{t('layers.title')}</h2>
          <p className="text-xs text-app-muted">
            {t('layers.description')}
          </p>
        </div>
        <button
          onClick={handleAdd}
          className="px-3 py-1.5 bg-app-primary hover:bg-app-primary-hover text-white rounded-lg text-xs font-semibold shadow-lg shadow-app-primary/20 transition-all duration-200 cursor-pointer"
        >
          {t('layers.create_layer')}
        </button>
      </div>

      {/* Info card */}
      <div className="bg-app-surface/40 border border-app-border rounded-xl p-2.5 flex gap-2.5 text-xs text-app-muted">
        <HelpCircle className="text-app-primary shrink-0" size={15} />
        <div>
          {t('layers.info_text')}
        </div>
      </div>

      {/* List of Layers */}
      <div className="space-y-3">
        {activeLayers.map((layer) => {
          const isEditing = editingId === layer.id;

          if (isEditing) {
            return (
              <div
                key={layer.id}
                className="bg-app-surface/90 backdrop-blur-md rounded-xl border border-app-primary/40 p-3.5 space-y-3 shadow-lg shadow-app-primary/5 transition-all duration-200"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-app-muted uppercase tracking-wider mb-1.5">{t('layers.name_label')}</label>
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full bg-app-surface-hover border border-app-border text-xs text-app-text rounded-lg p-1.5 focus:outline-none focus:ring-1 focus:ring-app-primary"
                      placeholder={t('layers.name_placeholder')}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-app-muted uppercase tracking-wider mb-1.5">{t('layers.priority_label')}</label>
                    <input
                      type="number"
                      value={editForm.priority}
                      onChange={(e) => setEditForm(prev => ({ ...prev, priority: parseInt(e.target.value) || 0 }))}
                      className="w-full bg-app-surface-hover border border-app-border text-xs text-app-text rounded-lg p-1.5 focus:outline-none focus:ring-1 focus:ring-app-primary"
                    />
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-app-muted uppercase tracking-wider mb-1.5">{t('layers.trigger_type_label')}</label>
                    <select
                      value={editForm.triggerType}
                      onChange={(e) => {
                        const type = e.target.value as any;
                        setEditForm(prev => ({ ...prev, triggerType: type, triggerValue: type === 'none' ? '' : prev.triggerValue }));
                      }}
                      className="w-full bg-app-surface-hover border border-app-border text-xs text-app-text rounded-lg p-1.5 focus:outline-none focus:ring-1 focus:ring-app-primary"
                    >
                      <option value="none">{t('layers.trigger_types.none')}</option>
                      <option value="hotkey">{t('layers.trigger_types.hotkey')}</option>
                      <option value="process">{t('layers.trigger_types.process')}</option>
                      <option value="window_title">{t('layers.trigger_types.window_title')}</option>
                    </select>
                  </div>
                  {editForm.triggerType !== 'none' && (
                    <div>
                      <label className="block text-[10px] font-bold text-app-muted uppercase tracking-wider mb-1.5">
                        {editForm.triggerType === 'hotkey'
                          ? t('layers.trigger_value_prompt.hotkey')
                          : editForm.triggerType === 'process'
                          ? t('layers.trigger_value_prompt.process')
                          : t('layers.trigger_value_prompt.window_title')}
                      </label>
                      {editForm.triggerType === 'hotkey' ? (
                        <button
                          type="button"
                          onClick={() => setCapturingLayerId(layer.id)}
                          className={`w-full p-1.5 border border-dashed rounded-lg text-xs text-center transition-all cursor-pointer ${
                            capturingLayerId === layer.id
                              ? 'border-app-primary bg-app-primary/10 text-app-text animate-pulse'
                              : 'border-app-border bg-app-surface-hover text-app-text hover:border-app-primary/30'
                          }`}
                        >
                          {capturingLayerId === layer.id ? t('layers.press_key_btn') : editForm.triggerValue || t('layers.click_record_btn')}
                        </button>
                      ) : (
                        <input
                          type="text"
                          value={editForm.triggerValue}
                          onChange={(e) => setEditForm(prev => ({ ...prev, triggerValue: e.target.value }))}
                          className="w-full bg-app-surface-hover border border-app-border text-xs text-app-text rounded-lg p-1.5 focus:outline-none focus:ring-1 focus:ring-app-primary"
                          placeholder={editForm.triggerType === 'process' ? 'notepad.exe' : 'Google Chrome'}
                        />
                      )}
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-app-border">
                  <button
                    onClick={() => setEditingId(null)}
                    className="px-2.5 py-1 text-[11px] font-semibold bg-app-surface-hover hover:bg-app-border border border-app-border text-app-muted hover:text-app-text rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <X size={12} /> {t('common.cancel')}
                  </button>
                  <button
                    onClick={() => handleSaveEdit(layer.id)}
                    className="px-2.5 py-1 text-[11px] font-semibold bg-app-primary hover:bg-app-primary-hover text-white rounded-lg transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <Check size={12} /> {t('common.save')}
                  </button>
                </div>
              </div>
            );
          }

          return (
            <div
              key={layer.id}
              className="bg-app-surface/60 backdrop-blur-md rounded-xl border border-app-border p-3 flex items-center justify-between hover:border-app-primary/30 transition-all duration-200 group"
            >
              <div className="flex items-center gap-3">
                {/* Layer icon */}
                <div className="p-2 bg-app-primary/10 rounded-lg border border-app-primary/20 text-app-primary">
                  <Layers size={16} />
                </div>
                
                <div>
                  <h3 className="font-bold text-app-text text-xs">{layer.name}</h3>
                  <div className="flex items-center gap-3 mt-1 text-[11px] text-app-muted font-medium">
                    <span>{t('layers.priority_text')}: <b className="text-app-text font-mono">{layer.priority}</b></span>
                    <span>•</span>
                    <span>
                      {t('layers.condition_text')}: {layer.triggerType === 'none' ? (
                        <span className="text-app-muted">{t('layers.cond_always_active')}</span>
                      ) : layer.triggerType === 'hotkey' ? (
                        <span>{t('layers.cond_held_key')}: <b className="keycap text-[10px] font-mono ml-1 py-0.5 px-1 bg-app-surface-hover text-app-accent">{layer.triggerValue}</b></span>
                      ) : layer.triggerType === 'process' ? (
                        <span>{t('layers.cond_process')}: <b className="text-app-accent font-mono">{layer.triggerValue}</b></span>
                      ) : (
                        <span>{t('layers.cond_window')}: <b className="text-app-accent font-semibold">{layer.triggerValue}</b></span>
                      )}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex gap-1">
                <button
                  onClick={() => handleStartEdit(layer)}
                  className="p-1.5 text-app-muted hover:text-app-primary hover:bg-app-primary/10 rounded-md transition-all duration-200 border border-app-border/60 hover:border-app-primary/20 text-xs cursor-pointer"
                  title={t('common.edit')}
                >
                  <Edit2 size={12} />
                </button>
                <button
                  onClick={() => deleteLayer(layer.id)}
                  className="p-1.5 text-app-muted hover:text-app-danger hover:bg-app-danger/10 rounded-md transition-all duration-200 border border-app-border/60 hover:border-app-danger/20 text-xs cursor-pointer"
                  title={t('common.delete')}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          );
        })}

        {activeLayers.length === 0 && (
          <div className="bg-app-surface/40 rounded-xl border border-app-border border-dashed p-8 text-center text-app-muted">
            <span className="text-3xl block mb-2 opacity-30">📚</span>
            {t('layers.no_layers')}
          </div>
        )}
      </div>
    </div>
  );
};