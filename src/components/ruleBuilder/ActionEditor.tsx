import React from 'react';
import { FrontendAction } from '../../lib/types';
import { KeyPicker } from './KeyPicker';
import { MacroEditor } from './MacroEditor';
import { useProfileStore } from '../../store/profileStore';

interface ActionEditorProps {
  action: FrontendAction;
  onChange: (action: FrontendAction) => void;
  onRemove: () => void;
}

export const ActionEditor: React.FC<ActionEditorProps> = ({ action, onChange, onRemove }) => {
  const showContentBelow = action.type === 'runMacro';

  return (
    <div className="flex flex-col gap-2 bg-app-surface-hover/50 p-2.5 rounded border border-app-border">
      <div className="flex gap-2 items-center w-full">
        <select
          value={action.type}
          onChange={(e) => {
            const type = e.target.value as any;
            if (type === 'remapKey' || type === 'remapMouse') {
              onChange({ type, code: 0 } as FrontendAction);
            } else if (type === 'typeText') {
              onChange({ type, text: '' } as FrontendAction);
            } else if (type === 'runMacro') {
              onChange({ type, steps: [] } as FrontendAction);
            } else if (type === 'toggleLayer' || type === 'holdLayer') {
              onChange({ type, layerId: '' } as FrontendAction);
            } else if (type === 'systemVolume') {
              onChange({ type, action: 'up' } as FrontendAction);
            } else if (type === 'mediaKey') {
              onChange({ type, key: 'play_pause' } as FrontendAction);
            } else if (type === 'windowAction') {
              onChange({ type, action: 'snap_left' } as FrontendAction);
            } else if (type === 'launchApp') {
              onChange({ type, path: '' } as FrontendAction);
            } else if (type === 'sleep' || type === 'monitorOff') {
              onChange({ type } as FrontendAction);
            }
          }}
          className="bg-app-surface-hover border border-app-border text-xs text-app-text rounded p-1 w-32 cursor-pointer"
        >
          <option value="remapKey">Remap Key</option>
          <option value="remapMouse">Remap Mouse</option>
          <option value="typeText">Type Text</option>
          <option value="runMacro">Run Macro</option>
          <option value="toggleLayer">Toggle Layer</option>
          <option value="holdLayer">Hold Layer</option>
          <option value="systemVolume">System Volume</option>
          <option value="mediaKey">Media Key</option>
          <option value="windowAction">Window Action</option>
          <option value="launchApp">Launch App</option>
          <option value="sleep">PC Sleep</option>
          <option value="monitorOff">Monitor Off</option>
        </select>
        
        {!showContentBelow && (
          <div className="flex-1 flex items-center gap-2">
            {action.type === 'typeText' && (
              <input 
                type="text" 
                value={action.text} 
                onChange={(e) => onChange({ ...action, text: e.target.value })}
                placeholder="Text to type"
                className="bg-app-bg border border-app-border text-xs text-app-text rounded p-1 flex-1"
              />
            )}

            {action.type === 'remapKey' && (
              <KeyPicker
                value={action.code || 0}
                onChange={(vk) => onChange({ ...action, code: vk })}
                className="flex-grow text-left"
              />
            )}

            {action.type === 'remapMouse' && (
              <select
                value={action.code || 1}
                onChange={(e) => onChange({ ...action, code: parseInt(e.target.value) || 1 })}
                className="bg-app-bg border border-app-border text-xs text-app-text rounded p-1 flex-1 cursor-pointer"
              >
                <option value="1">Left Button (1)</option>
                <option value="2">Right Button (2)</option>
                <option value="3">Middle Button (3)</option>
                <option value="4">X1 Button (4)</option>
                <option value="5">X2 Button (5)</option>
              </select>
            )}

            {(action.type === 'toggleLayer' || action.type === 'holdLayer') && (() => {
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
                  value={action.layerId}
                  onChange={(e) => onChange({ ...action, layerId: e.target.value } as any)}
                  className="bg-app-bg border border-app-border text-xs text-app-text rounded p-1 flex-1 cursor-pointer"
                >
                  {!action.layerId && <option value="">Select a layer...</option>}
                  {layers.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              );
            })()}

            {action.type === 'systemVolume' && (
              <select
                value={action.action}
                onChange={(e) => onChange({ ...action, action: e.target.value as any })}
                className="bg-app-bg border border-app-border text-xs text-app-text rounded p-1 flex-1 cursor-pointer"
              >
                <option value="up">Volume Up</option>
                <option value="down">Volume Down</option>
                <option value="mute">Mute / Unmute</option>
              </select>
            )}

            {action.type === 'mediaKey' && (
              <select
                value={action.key}
                onChange={(e) => onChange({ ...action, key: e.target.value as any })}
                className="bg-app-bg border border-app-border text-xs text-app-text rounded p-1 flex-1 cursor-pointer"
              >
                <option value="play_pause">Play / Pause</option>
                <option value="next">Next Track</option>
                <option value="prev">Previous Track</option>
                <option value="stop">Stop Playback</option>
              </select>
            )}

            {action.type === 'windowAction' && (
              <select
                value={action.action}
                onChange={(e) => onChange({ ...action, action: e.target.value as any })}
                className="bg-app-bg border border-app-border text-xs text-app-text rounded p-1 flex-1 cursor-pointer"
              >
                <option value="snap_left">Snap Left</option>
                <option value="snap_right">Snap Right</option>
                <option value="snap_center">Snap Center</option>
                <option value="minimize">Minimize Window</option>
                <option value="maximize">Maximize Window</option>
                <option value="close">Close Window</option>
              </select>
            )}

            {action.type === 'launchApp' && (
              <div className="flex gap-2 flex-1 items-center">
                <input
                  type="text"
                  value={action.path}
                  onChange={(e) => onChange({ ...action, path: e.target.value })}
                  placeholder="Application Path (e.g. notepad.exe)"
                  className="bg-app-bg border border-app-border text-xs text-app-text rounded p-1 flex-1"
                />
                <button
                  type="button"
                  onClick={async () => {
                    const { open } = await import('@tauri-apps/plugin-dialog');
                    const selected = await open({
                      multiple: false,
                      directory: false,
                      filters: [{ name: 'Applications', extensions: ['exe', 'lnk', 'bat', 'cmd'] }]
                    });
                    if (selected) {
                      onChange({ ...action, path: typeof selected === 'string' ? selected : selected[0] });
                    }
                  }}
                  className="px-3 h-[26px] flex items-center justify-center text-xs font-semibold bg-app-surface border border-app-border text-app-text rounded hover:bg-app-surface-hover transition-colors cursor-pointer shrink-0"
                >
                  Browse...
                </button>
              </div>
            )}
          </div>
        )}

        <button 
          onClick={onRemove}
          className="text-app-danger hover:text-red-400 p-1 cursor-pointer shrink-0 ml-auto"
          title="Remove Action"
        >
          ✕
        </button>
      </div>

      {showContentBelow && (
        <div className="w-full">
          {action.type === 'runMacro' && (
            <MacroEditor
              steps={action.steps || []}
              onChange={(steps) => onChange({ ...action, steps })}
            />
          )}
        </div>
      )}
    </div>
  );
};
