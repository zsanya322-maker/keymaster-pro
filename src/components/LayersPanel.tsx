import React, { useState } from 'react';
import { useProfileStore } from '../store/profileStore';
import { useAppStore } from '../stores/app-store';
import { LayerMeta } from '../lib/types';
import { Layers, Plus, Trash2, Edit2, Check, X } from 'lucide-react';

export const LayersPanel: React.FC = () => {
  const { activeProfileId, profiles, saveProfile } = useProfileStore();
  const daemonConnected = useAppStore(state => state.daemonConnected);
  const activeProfile = profiles.find((p) => p.id === activeProfileId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  if (!activeProfile) {
    if (!daemonConnected) {
      return (
        <div className="p-8 text-center text-app-muted flex flex-col items-center gap-3">
          <div className="text-2xl opacity-50">🔌</div>
          <div className="font-semibold">Daemon не подключён</div>
          <div className="text-xs max-w-md">
            Перейдите в <span className="text-app-primary font-semibold">Settings → Daemon</span> и нажмите «Restart Daemon».
          </div>
        </div>
      );
    }
    if (profiles.length > 0) {
      return (
        <div className="flex h-[400px] items-center justify-center text-app-muted">
          Выберите профиль в меню Profiles (верхняя панель)
        </div>
      );
    }
    return (
      <div className="flex h-[400px] items-center justify-center text-app-muted">
        Daemon подключён, загружаю профили…
      </div>
    );
  }

  const getRulesCountForLayer = (layerId: string) => {
    return activeProfile.rules.filter((rule) => {
      // Check conditions
      const hasLayerCondition = rule.conditions.some(
        (cond) => cond.type === 'layerActive' && cond.layerId === layerId
      );
      // Check actions
      const hasLayerAction = rule.actions.some(
        (act) => (act.type === 'toggleLayer' || act.type === 'holdLayer') && act.layerId === layerId
      );
      // Check holdActions
      const hasLayerHoldAction =
        rule.holdActions?.some(
          (act) => (act.type === 'toggleLayer' || act.type === 'holdLayer') && act.layerId === layerId
        ) || false;

      return hasLayerCondition || hasLayerAction || hasLayerHoldAction;
    }).length;
  };

  const handleCreateLayer = () => {
    const newLayer: LayerMeta = {
      id: crypto.randomUUID(),
      name: `Layer ${activeProfile.layers.length + 1}`,
    };
    const updatedLayers = [...activeProfile.layers, newLayer];
    saveProfile({
      ...activeProfile,
      layers: updatedLayers,
    });
  };

  const handleDeleteLayer = (layerId: string, layerName: string) => {
    const rulesCount = getRulesCountForLayer(layerId);
    let confirmMsg = `Are you sure you want to delete the layer "${layerName}"?`;
    if (rulesCount > 0) {
      confirmMsg = `WARNING: The layer "${layerName}" is used in ${rulesCount} rules.\nDeleting this layer will break those rules.\n\nAre you sure you want to proceed?`;
    }

    if (window.confirm(confirmMsg)) {
      const updatedLayers = activeProfile.layers.filter((l) => l.id !== layerId);
      saveProfile({
        ...activeProfile,
        layers: updatedLayers,
      });
    }
  };

  const handleStartRename = (layer: LayerMeta) => {
    setEditingId(layer.id);
    setEditingName(layer.name);
  };

  const handleSaveRename = (layerId: string) => {
    const trimmed = editingName.trim();
    if (!trimmed) return;

    const updatedLayers = activeProfile.layers.map((l) =>
      l.id === layerId ? { ...l, name: trimmed } : l
    );

    saveProfile({
      ...activeProfile,
      layers: updatedLayers,
    });
    setEditingId(null);
  };

  const handleCancelRename = () => {
    setEditingId(null);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto p-4 select-none">
      <div className="flex items-center justify-between border-b border-app-border pb-4">
        <div>
          <h2 className="text-xl font-bold text-app-text flex items-center gap-2">
            <Layers className="text-app-primary" />
            Layers Management
          </h2>
          <p className="text-xs text-app-muted mt-1">
            Create, rename, or remove conditional layers for the active profile "{activeProfile.name}".
          </p>
        </div>
        <button
          onClick={handleCreateLayer}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-app-primary text-white rounded-lg hover:bg-app-primary/80 transition-colors shadow-md cursor-pointer h-9"
        >
          <Plus size={14} />
          Create Layer
        </button>
      </div>

      {activeProfile.layers.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-app-border rounded-xl bg-app-surface/20">
          <Layers size={48} className="mx-auto text-app-muted opacity-30 mb-3 animate-pulse" />
          <h3 className="text-sm font-semibold text-app-text">No Layers Configured</h3>
          <p className="text-xs text-app-muted mt-1 max-w-md mx-auto">
            Layers let you dynamically change keyboard layouts (e.g. hold "Fn" to activate media navigation on IJKL keys).
          </p>
          <button
            onClick={handleCreateLayer}
            className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-app-primary/20 text-app-primary rounded-lg hover:bg-app-primary/30 transition-colors border border-app-primary/30 cursor-pointer"
          >
            <Plus size={14} />
            Create your first layer
          </button>
        </div>
      ) : (
        <div className="grid gap-3">
          {activeProfile.layers.map((layer) => {
            const rulesCount = getRulesCountForLayer(layer.id);
            const isEditing = editingId === layer.id;

            return (
              <div
                key={layer.id}
                onDoubleClick={() => !isEditing && handleStartRename(layer)}
                className="flex items-center justify-between p-4 rounded-xl border border-app-border bg-app-surface/40 hover:bg-app-surface/60 transition-all duration-200"
              >
                <div className="flex-1 flex items-center gap-3 mr-4">
                  <div className="p-2 rounded-lg bg-app-primary/10 border border-app-primary/20 shrink-0">
                    <Layers size={16} className="text-app-primary" />
                  </div>

                  {isEditing ? (
                    <div className="flex items-center gap-2 w-full max-w-md">
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSaveRename(layer.id)}
                        className="bg-app-bg border border-app-border text-sm text-app-text rounded px-2 py-1 w-full focus:outline-none focus:border-app-primary"
                        autoFocus
                      />
                      <button
                        onClick={() => handleSaveRename(layer.id)}
                        className="p-1 text-green-500 hover:bg-green-500/10 rounded cursor-pointer"
                      >
                        <Check size={16} />
                      </button>
                      <button
                        onClick={handleCancelRename}
                        className="p-1 text-app-danger hover:bg-app-danger/10 rounded cursor-pointer"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <div>
                      <h3 className="text-sm font-semibold text-app-text flex items-center gap-2">
                        {layer.name}
                        <button
                          onClick={() => handleStartRename(layer)}
                          className="opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-app-primary p-0.5 text-app-muted cursor-pointer transition-opacity"
                          title="Rename Layer"
                        >
                          <Edit2 size={12} />
                        </button>
                      </h3>
                      <p className="text-[10px] text-app-muted font-mono mt-0.5">
                        ID: {layer.id}
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${
                      rulesCount > 0
                        ? 'bg-app-primary/10 text-app-primary border border-app-primary/20'
                        : 'bg-app-surface-hover text-app-muted border border-app-border'
                    }`}
                  >
                    {rulesCount > 0 && rulesCount} {rulesCount === 1 ? 'rule' : 'rules'} referencing
                  </span>

                  <div className="flex items-center gap-1">
                    {!isEditing && (
                      <button
                        onClick={() => handleStartRename(layer)}
                        className="p-1.5 text-app-muted hover:text-app-text hover:bg-app-surface-hover rounded-lg transition-colors cursor-pointer"
                        title="Rename Layer"
                      >
                        <Edit2 size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteLayer(layer.id, layer.name)}
                      className="p-1.5 text-app-danger hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                      title="Delete Layer"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
