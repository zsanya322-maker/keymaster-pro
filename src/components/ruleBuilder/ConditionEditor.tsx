import React from 'react';
import { FrontendCondition } from '../../lib/types';
import { useProfileStore } from '../../store/profileStore';

interface ConditionEditorProps {
  condition: FrontendCondition;
  onChange: (condition: FrontendCondition) => void;
  onRemove: () => void;
}

export const ConditionEditor: React.FC<ConditionEditorProps> = ({ condition, onChange, onRemove }) => {
  return (
    <div className="flex gap-2 items-center bg-app-surface-hover/50 p-2 rounded border border-app-border">
      <select
        value={condition.type}
        onChange={(e) => {
          const type = e.target.value as any;
          if (type === 'windowFocused') {
            onChange({ type, process: '' } as FrontendCondition);
          } else if (type === 'layerActive') {
            onChange({ type, layerId: '' } as FrontendCondition);
          } else if (type === 'virtualDesktop') {
            onChange({ type, id: 0 } as FrontendCondition);
          }
        }}
        className="bg-app-surface-hover border border-app-border text-xs text-app-text rounded p-1 w-32"
      >
        <option value="windowFocused">Window Focused</option>
        <option value="layerActive">Layer Active</option>
        <option value="virtualDesktop" disabled>Virtual Desktop (coming soon)</option>
      </select>

      {condition.type === 'windowFocused' && (
        <input 
          type="text" 
          value={condition.process} 
          onChange={(e) => onChange({ ...condition, process: e.target.value })}
          placeholder="Process (e.g. chrome.exe)"
          className="bg-app-bg border border-app-border text-xs text-app-text rounded p-1 flex-1"
        />
      )}

      {condition.type === 'layerActive' && (() => {
        const { activeProfileId, profiles } = useProfileStore();
        const activeProfile = profiles.find((p) => p.id === activeProfileId);
        const layers = activeProfile?.layers || [];

        if (layers.length === 0) {
          return (
            <span className="text-xs text-app-danger italic flex-1">
              Create a layer first in the Layers Meta section
            </span>
          );
        }

        return (
          <select
            value={condition.layerId}
            onChange={(e) => onChange({ ...condition, layerId: e.target.value })}
            className="bg-app-bg border border-app-border text-xs text-app-text rounded p-1 flex-1 cursor-pointer"
          >
            {!condition.layerId && <option value="">Select a layer...</option>}
            {layers.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        );
      })()}

      {condition.type === 'virtualDesktop' && (
        <input 
          type="number" 
          value={condition.id} 
          onChange={(e) => onChange({ ...condition, id: parseInt(e.target.value) || 0 })}
          placeholder="Desktop ID"
          className="bg-app-bg border border-app-border text-xs text-app-text rounded p-1 flex-1"
        />
      )}

      <button 
        onClick={onRemove}
        className="text-app-danger hover:text-red-400 p-1"
        title="Remove Condition"
      >
        ✕
      </button>
    </div>
  );
};
