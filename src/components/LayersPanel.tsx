import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Edit2, Layers, Plus, Trash2, X } from 'lucide-react';
import { useProfileStore } from '../store/profileStore';
import { useAppStore } from '../stores/app-store';
import type { LayerMeta } from '../lib/types';
import { ConfirmDialog } from './ConfirmDialog';

interface PendingDelete {
  id: string;
  name: string;
  rulesCount: number;
}

export const LayersPanel: React.FC = () => {
  const { t } = useTranslation();
  const { activeProfileId, profiles, saveProfile } = useProfileStore();
  const daemonConnected = useAppStore(state => state.daemonConnected);
  const activeProfile = profiles.find(profile => profile.id === activeProfileId);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [saving, setSaving] = useState(false);

  if (!activeProfile) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-app-muted">
        {!daemonConnected
          ? t('layers.daemon_off_title')
          : profiles.length > 0
            ? t('layers.no_profile_select')
            : t('layers.loading_profiles')}
      </div>
    );
  }

  const getRulesCountForLayer = (layerId: string) => activeProfile.rules.filter(rule => {
    const hasLayerCondition = rule.conditions.some(
      condition => condition.type === 'layerActive' && condition.layerId === layerId,
    );
    const hasLayerAction = rule.actions.some(
      action => (action.type === 'toggleLayer' || action.type === 'holdLayer') && action.layerId === layerId,
    );
    const hasLayerHoldAction = rule.holdActions?.some(
      action => (action.type === 'toggleLayer' || action.type === 'holdLayer') && action.layerId === layerId,
    ) || false;

    return hasLayerCondition || hasLayerAction || hasLayerHoldAction;
  }).length;

  const handleCreateLayer = async () => {
    if (saving) return;
    const newLayer: LayerMeta = {
      id: crypto.randomUUID(),
      name: t('layers.new_layer_default', { n: activeProfile.layers.length + 1 }),
    };
    setSaving(true);
    try {
      await saveProfile({ ...activeProfile, layers: [...activeProfile.layers, newLayer] });
    } finally {
      setSaving(false);
    }
  };

  const handleStartRename = (layer: LayerMeta) => {
    setEditingId(layer.id);
    setEditingName(layer.name);
  };

  const handleSaveRename = async (layerId: string) => {
    const trimmed = editingName.trim();
    if (!trimmed || saving) return;

    const layers = activeProfile.layers.map(layer =>
      layer.id === layerId ? { ...layer, name: trimmed } : layer,
    );

    setSaving(true);
    try {
      const saved = await saveProfile({ ...activeProfile, layers });
      if (saved) setEditingId(null);
    } finally {
      setSaving(false);
    }
  };

  const requestDelete = (layer: LayerMeta) => {
    if (saving) return;
    setPendingDelete({
      id: layer.id,
      name: layer.name,
      rulesCount: getRulesCountForLayer(layer.id),
    });
  };

  const confirmDelete = async () => {
    if (!pendingDelete || saving) return;
    const layers = activeProfile.layers.filter(layer => layer.id !== pendingDelete.id);

    setSaving(true);
    try {
      const saved = await saveProfile({ ...activeProfile, layers });
      if (saved) setPendingDelete(null);
    } finally {
      setSaving(false);
    }
  };

  const rulesCountLabel = (count: number) => {
    if (count === 0) return t('layers.rules_zero');
    if (count === 1) return t('layers.rules_one', { count });
    return t('layers.rules_many', { count });
  };

  const deleteMessage = pendingDelete
    ? pendingDelete.rulesCount > 0
      ? t('layers.confirm_delete_used_warning', { name: pendingDelete.name, count: pendingDelete.rulesCount })
      : t('layers.confirm_delete', { name: pendingDelete.name })
    : '';

  return (
    <div className="h-full min-h-0 flex flex-col bg-app-bg select-none">
      <div className="h-10 px-3 border-b border-app-border bg-app-surface/45 flex items-center shrink-0">
        <Layers size={14} className="text-app-primary mr-2" />
        <h2 className="text-xs font-semibold text-app-text">{t('layers.title')}</h2>
        <span className="ml-2 text-[10px] text-app-muted">{activeProfile.layers.length}</span>
        <button
          type="button"
          disabled={saving}
          onClick={() => void handleCreateLayer()}
          className="ml-auto h-7 px-2.5 flex items-center gap-1.5 text-[11px] border border-app-border bg-app-bg hover:bg-app-surface text-app-text disabled:opacity-40"
        >
          <Plus size={13} className="text-app-success" />
          {t('layers.create_layer')}
        </button>
      </div>

      <div className="px-3 py-2 border-b border-app-border/65 text-[10px] text-app-muted shrink-0">
        {t('layers.description', { name: activeProfile.name })}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeProfile.layers.length === 0 ? (
          <div className="h-full min-h-56 flex flex-col items-center justify-center text-center px-6">
            <Layers size={26} className="text-app-muted opacity-35" />
            <div className="mt-3 text-xs font-semibold text-app-text">{t('layers.no_layers_title')}</div>
            <div className="mt-1 max-w-md text-[10px] leading-5 text-app-muted">{t('layers.no_layers_desc')}</div>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleCreateLayer()}
              className="mt-4 h-7 px-2.5 flex items-center gap-1.5 text-[11px] border border-app-border hover:bg-app-surface disabled:opacity-40"
            >
              <Plus size={13} /> {t('layers.create_first')}
            </button>
          </div>
        ) : (
          activeProfile.layers.map(layer => {
            const rulesCount = getRulesCountForLayer(layer.id);
            const isEditing = editingId === layer.id;

            return (
              <div
                key={layer.id}
                onDoubleClick={() => !isEditing && handleStartRename(layer)}
                className="group min-h-12 px-3 py-1.5 border-b border-app-border/60 flex items-center gap-2.5 hover:bg-app-surface/35"
              >
                <Layers size={14} className="text-app-primary shrink-0" />

                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <div className="flex items-center gap-1.5 max-w-md">
                      <input
                        type="text"
                        value={editingName}
                        disabled={saving}
                        onChange={event => setEditingName(event.target.value)}
                        onKeyDown={event => {
                          if (event.key === 'Enter') void handleSaveRename(layer.id);
                          if (event.key === 'Escape' && !saving) setEditingId(null);
                        }}
                        autoFocus
                        className="h-7 flex-1 min-w-0 px-2 text-[11px] bg-app-bg border border-app-border outline-none focus:border-app-primary disabled:opacity-50"
                      />
                      <button
                        type="button"
                        disabled={saving || !editingName.trim()}
                        onClick={() => void handleSaveRename(layer.id)}
                        className="h-7 w-7 flex items-center justify-center border border-transparent hover:border-app-border hover:bg-app-surface text-app-success disabled:opacity-35"
                      >
                        <Check size={13} />
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => setEditingId(null)}
                        className="h-7 w-7 flex items-center justify-center border border-transparent hover:border-app-border hover:bg-app-surface text-app-muted disabled:opacity-35"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="text-[11px] font-semibold text-app-text truncate">{layer.name}</div>
                      <div className="mt-0.5 text-[9px] text-app-muted truncate">{t('layers.id_label')}: {layer.id}</div>
                    </>
                  )}
                </div>

                <span className="text-[10px] text-app-muted whitespace-nowrap">{rulesCountLabel(rulesCount)}</span>

                {!isEditing && (
                  <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleStartRename(layer)}
                      className="h-7 w-7 flex items-center justify-center border border-transparent hover:border-app-border hover:bg-app-bg text-app-muted hover:text-app-text disabled:opacity-30"
                      title={t('layers.rename_tooltip')}
                    >
                      <Edit2 size={12} />
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => requestDelete(layer)}
                      className="h-7 w-7 flex items-center justify-center border border-transparent hover:border-app-border hover:bg-app-bg text-app-muted hover:text-app-danger disabled:opacity-30"
                      title={t('layers.delete_tooltip')}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="h-8 px-3 border-t border-app-border bg-app-surface/35 flex items-center text-[10px] text-app-muted shrink-0">
        {t('layers.title')}: {activeProfile.layers.length}
        {saving && <span className="ml-auto text-app-primary">{t('common.saving', 'Сохранение…')}</span>}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('layers.delete_tooltip')}
        message={deleteMessage}
        confirmLabel={t('common.delete')}
        danger
        onCancel={() => { if (!saving) setPendingDelete(null); }}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
};
