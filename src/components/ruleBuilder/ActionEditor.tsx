import React from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
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
  const { t } = useTranslation();
  const showContentBelow = action.type === 'runMacro';
  // Хук на верхнем уровне (раньше вызывался в IIFE по условию — нарушение
  // Rules of Hooks, причина чёрного/белого экрана на toggleLayer/holdLayer).
  const { activeProfileId, profiles } = useProfileStore();
  const activeProfile = profiles.find((p) => p.id === activeProfileId);
  const layers = activeProfile?.layers || [];

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
            } else if (type === 'focusProcess') {
              onChange({ type, process: '' } as FrontendAction);
            } else if (type === 'sleep' || type === 'monitorOff') {
              onChange({ type } as FrontendAction);
            }
          }}
          className="bg-app-surface-hover border border-app-border text-xs text-app-text rounded p-1 w-32 cursor-pointer"
        >
          <option value="remapKey">{t('ruleBuilder.action_types.remapKey')}</option>
          <option value="remapMouse">{t('ruleBuilder.action_types.remapMouse')}</option>
          <option value="typeText">{t('ruleBuilder.action_types.typeText')}</option>
          <option value="runMacro">{t('ruleBuilder.action_types.runMacro')}</option>
          <option value="toggleLayer">{t('ruleBuilder.action_types.toggleLayer')}</option>
          <option value="holdLayer">{t('ruleBuilder.action_types.holdLayer')}</option>
          <option value="systemVolume">{t('ruleBuilder.action_types.systemVolume')}</option>
          <option value="mediaKey">{t('ruleBuilder.action_types.mediaKey')}</option>
          <option value="windowAction">{t('ruleBuilder.action_types.windowAction')}</option>
          <option value="launchApp">{t('ruleBuilder.action_types.launchApp')}</option>
          <option value="focusProcess">{t('ruleBuilder.action_types.focusProcess')}</option>
          <option value="sleep">{t('ruleBuilder.action_types.sleep')}</option>
          <option value="monitorOff">{t('ruleBuilder.action_types.monitorOff')}</option>
        </select>
        
        {!showContentBelow && (
          <div className="flex-1 flex items-center gap-2">
            {action.type === 'typeText' && (
              <input 
                type="text" 
                value={action.text} 
                onChange={(e) => onChange({ ...action, text: e.target.value })}
                placeholder={t('ruleBuilder.placeholders.text_to_type')}
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
                <option value="1">{t('ruleBuilder.action_options.mouse_left')}</option>
                <option value="2">{t('ruleBuilder.action_options.mouse_right')}</option>
                <option value="3">{t('ruleBuilder.action_options.mouse_middle')}</option>
                <option value="4">{t('ruleBuilder.action_options.mouse_x1')}</option>
                <option value="5">{t('ruleBuilder.action_options.mouse_x2')}</option>
              </select>
            )}

            {(action.type === 'toggleLayer' || action.type === 'holdLayer') && (
              layers.length === 0 ? (
                <span className="text-xs text-app-danger italic flex-1">
                  {t('ruleBuilder.hints.create_layer_first')}
                </span>
              ) : (
                <select
                  value={action.layerId}
                  onChange={(e) => onChange({ ...action, layerId: e.target.value } as any)}
                  className="bg-app-bg border border-app-border text-xs text-app-text rounded p-1 flex-1 cursor-pointer"
                >
                  {!action.layerId && <option value="">{t('ruleBuilder.hints.select_layer')}</option>}
                  {layers.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              )
            )}

            {action.type === 'systemVolume' && (
              <select
                value={action.action}
                onChange={(e) => onChange({ ...action, action: e.target.value as any })}
                className="bg-app-bg border border-app-border text-xs text-app-text rounded p-1 flex-1 cursor-pointer"
              >
                <option value="up">{t('ruleBuilder.action_options.volume_up')}</option>
                <option value="down">{t('ruleBuilder.action_options.volume_down')}</option>
                <option value="mute">{t('ruleBuilder.action_options.volume_mute')}</option>
              </select>
            )}

            {action.type === 'mediaKey' && (
              <select
                value={action.key}
                onChange={(e) => onChange({ ...action, key: e.target.value as any })}
                className="bg-app-bg border border-app-border text-xs text-app-text rounded p-1 flex-1 cursor-pointer"
              >
                <option value="play_pause">{t('ruleBuilder.action_options.media_play_pause')}</option>
                <option value="next">{t('ruleBuilder.action_options.media_next')}</option>
                <option value="prev">{t('ruleBuilder.action_options.media_prev')}</option>
                <option value="stop">{t('ruleBuilder.action_options.media_stop')}</option>
              </select>
            )}

            {action.type === 'windowAction' && (
              <select
                value={action.action}
                onChange={(e) => onChange({ ...action, action: e.target.value as any })}
                className="bg-app-bg border border-app-border text-xs text-app-text rounded p-1 flex-1 cursor-pointer"
              >
                <option value="snap_left">{t('ruleBuilder.action_options.window_snap_left')}</option>
                <option value="snap_right">{t('ruleBuilder.action_options.window_snap_right')}</option>
                <option value="snap_center">{t('ruleBuilder.action_options.window_snap_center')}</option>
                <option value="minimize">{t('ruleBuilder.action_options.window_minimize')}</option>
                <option value="maximize">{t('ruleBuilder.action_options.window_maximize')}</option>
                <option value="close">{t('ruleBuilder.action_options.window_close')}</option>
              </select>
            )}

            {action.type === 'launchApp' && (
              <div className="flex gap-2 flex-1 items-center">
                <input
                  type="text"
                  value={action.path}
                  onChange={(e) => onChange({ ...action, path: e.target.value })}
                  placeholder={t('ruleBuilder.placeholders.app_path')}
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
                  {t('common.browse')}
                </button>
              </div>
            )}

            {action.type === 'focusProcess' && (
              <div className="flex gap-2 flex-1 items-center">
                <input
                  type="text"
                  value={action.process}
                  onChange={(e) => onChange({ ...action, process: e.target.value })}
                  placeholder={t('ruleBuilder.placeholders.process')}
                  className="bg-app-bg border border-app-border text-xs text-app-text rounded p-1 flex-1"
                />
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await invoke<{ process: string; title: string }>('ipc_call', { method: 'get_active_window' });
                      if (res.process) {
                        onChange({ ...action, process: res.process });
                      }
                    } catch (e) {
                      console.error('Failed to capture active window', e);
                    }
                  }}
                  className="px-3 h-[26px] flex items-center justify-center text-xs font-semibold bg-app-primary text-white rounded hover:bg-app-primary/80 transition-colors cursor-pointer shrink-0"
                  title={t('ruleBuilder.hints.capture_window', 'Захватить активное окно')}
                >
                  📸 {t('ruleBuilder.buttons.capture', 'Захват')}
                </button>
              </div>
            )}
          </div>
        )}

        <button 
          onClick={onRemove}
          className="text-app-danger hover:text-red-400 p-1 cursor-pointer shrink-0 ml-auto"
          title={t('ruleBuilder.remove_action_tooltip')}
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
