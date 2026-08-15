import React from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { Crosshair, FolderOpen, Trash2 } from 'lucide-react';
import type { FrontendAction } from '../../lib/types';
import { KeyPicker } from './KeyPicker';
import { MacroEditor } from './MacroEditor';
import { useProfileStore } from '../../store/profileStore';

interface ActionEditorProps {
  action: FrontendAction;
  onChange: (action: FrontendAction) => void;
  onRemove: () => void;
}

const controlClass = 'h-7 border border-app-border bg-app-bg px-2 text-[11px] text-app-text outline-none focus:border-app-primary';
const selectClass = `${controlClass} cursor-pointer`;

type WindowActionName = 'snap_left' | 'snap_right' | 'snap_center' | 'minimize' | 'maximize' | 'close';

export const ActionEditor: React.FC<ActionEditorProps> = ({ action, onChange, onRemove }) => {
  const { t } = useTranslation();
  const { activeProfileId, profiles } = useProfileStore();
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId);
  const layers = activeProfile?.layers || [];
  const showContentBelow = action.type === 'runMacro';

  const changeType = (type: FrontendAction['type']) => {
    if (type === 'remapKey') {
      onChange({ type: 'remapKey', code: 0, modifiers: 0 });
    } else if (type === 'remapMouse') {
      onChange({ type: 'remapMouse', code: 1 });
    } else if (type === 'typeText') {
      onChange({ type, text: '' });
    } else if (type === 'runMacro') {
      onChange({ type, steps: [] });
    } else if (type === 'toggleLayer' || type === 'holdLayer') {
      onChange({ type, layerId: '' });
    } else if (type === 'systemVolume') {
      onChange({ type, action: 'up' });
    } else if (type === 'mediaKey') {
      onChange({ type, key: 'play_pause' });
    } else if (type === 'windowAction') {
      onChange({ type, action: 'snap_left' });
    } else if (type === 'launchApp') {
      onChange({ type, path: '' });
    } else if (type === 'focusProcess') {
      onChange({ type, process: '', title: '' });
    } else {
      onChange({ type } as FrontendAction);
    }
  };

  return (
    <div className="border border-app-border/70 bg-app-bg">
      <div className="min-h-9 px-1.5 py-1 flex items-center gap-1.5">
        <select
          value={action.type}
          onChange={(event) => changeType(event.target.value as FrontendAction['type'])}
          className={`${selectClass} w-[154px] shrink-0 bg-app-surface/35`}
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
          <div className="flex-1 min-w-0 flex items-center gap-1.5">
            {action.type === 'typeText' && (
              <input
                type="text"
                value={action.text}
                onChange={(event) => onChange({ ...action, text: event.target.value })}
                placeholder={t('ruleBuilder.placeholders.text_to_type')}
                className={`${controlClass} flex-1 min-w-0`}
              />
            )}

            {action.type === 'remapKey' && (
              <KeyPicker
                value={{ code: action.code || 0, modifiers: action.modifiers || 0 }}
                onChange={(chord) => onChange({ ...action, ...chord })}
                className="flex-1 min-w-0 text-left"
              />
            )}

            {action.type === 'remapMouse' && (
              <select
                value={action.code || 1}
                onChange={(event) => onChange({ ...action, code: Number.parseInt(event.target.value, 10) || 1 })}
                className={`${selectClass} flex-1 min-w-0`}
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
                <div className="h-7 flex-1 flex items-center text-[10px] text-app-danger">
                  {t('ruleBuilder.hints.create_layer_first')}
                </div>
              ) : (
                <select
                  value={action.layerId}
                  onChange={(event) => onChange({ ...action, layerId: event.target.value } as FrontendAction)}
                  className={`${selectClass} flex-1 min-w-0`}
                >
                  {!action.layerId && <option value="">{t('ruleBuilder.hints.select_layer')}</option>}
                  {layers.map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}
                </select>
              )
            )}

            {action.type === 'systemVolume' && (
              <select
                value={action.action}
                onChange={(event) => onChange({ ...action, action: event.target.value as 'up' | 'down' | 'mute' })}
                className={`${selectClass} flex-1 min-w-0`}
              >
                <option value="up">{t('ruleBuilder.action_options.volume_up')}</option>
                <option value="down">{t('ruleBuilder.action_options.volume_down')}</option>
                <option value="mute">{t('ruleBuilder.action_options.volume_mute')}</option>
              </select>
            )}

            {action.type === 'mediaKey' && (
              <select
                value={action.key}
                onChange={(event) => onChange({ ...action, key: event.target.value as 'play_pause' | 'next' | 'prev' | 'stop' })}
                className={`${selectClass} flex-1 min-w-0`}
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
                onChange={(event) => onChange({ ...action, action: event.target.value as WindowActionName })}
                className={`${selectClass} flex-1 min-w-0`}
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
              <>
                <input
                  type="text"
                  value={action.path}
                  onChange={(event) => onChange({ ...action, path: event.target.value })}
                  placeholder={t('ruleBuilder.placeholders.app_path')}
                  className={`${controlClass} flex-1 min-w-0`}
                />
                <button
                  type="button"
                  onClick={async () => {
                    const { open } = await import('@tauri-apps/plugin-dialog');
                    const selected = await open({
                      multiple: false,
                      directory: false,
                      filters: [{ name: 'Applications', extensions: ['exe', 'lnk', 'bat', 'cmd'] }],
                    });
                    if (selected) onChange({ ...action, path: typeof selected === 'string' ? selected : selected[0] });
                  }}
                  className="h-7 px-2 shrink-0 inline-flex items-center gap-1 border border-app-border bg-app-bg text-[10px] text-app-text hover:bg-app-surface"
                  title={t('common.browse')}
                >
                  <FolderOpen size={11} />
                  {t('common.browse')}
                </button>
              </>
            )}

            {action.type === 'focusProcess' && (
              <>
                <input
                  type="text"
                  value={action.process ?? ''}
                  onChange={(event) => onChange({ ...action, process: event.target.value || undefined })}
                  placeholder={t('ruleBuilder.placeholders.process')}
                  className={`${controlClass} flex-1 min-w-0`}
                />
                <input
                  type="text"
                  value={action.title ?? ''}
                  onChange={(event) => onChange({ ...action, title: event.target.value || undefined })}
                  placeholder={t('ruleBuilder.placeholders.title', { defaultValue: 'Заголовок содержит' })}
                  className={`${controlClass} flex-1 min-w-0`}
                />
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await new Promise((resolve) => setTimeout(resolve, 3000));
                      const result = await invoke<{ process: string; title: string }>('ipc_call', { method: 'get_active_window' });
                      onChange({
                        ...action,
                        process: result.process || action.process,
                        title: result.title || action.title,
                      });
                    } catch (error) {
                      console.error('Failed to capture active window', error);
                    }
                  }}
                  className="h-7 px-2 shrink-0 inline-flex items-center gap-1 border border-app-border bg-app-bg text-[10px] text-app-text hover:bg-app-surface"
                  title={t('ruleBuilder.hints.capture_window_3s', { defaultValue: 'Захват через 3 сек — переключитесь на нужное окно' })}
                >
                  <Crosshair size={11} />
                  {t('ruleBuilder.buttons.capture')}
                </button>
              </>
            )}

            {(action.type === 'sleep' || action.type === 'monitorOff') && (
              <div className="h-7 flex-1 flex items-center text-[10px] text-app-muted">
                {t('ruleBuilder.hints.no_parameters', { defaultValue: 'Без параметров' })}
              </div>
            )}
          </div>
        )}

        {showContentBelow && (
          <div className="h-7 flex-1 flex items-center text-[10px] text-app-muted">
            {t('macro.title')}
          </div>
        )}

        <button
          type="button"
          onClick={onRemove}
          className="h-7 w-7 shrink-0 inline-flex items-center justify-center text-app-muted hover:bg-app-surface hover:text-app-danger"
          title={t('ruleBuilder.remove_action_tooltip')}
        >
          <Trash2 size={12} />
        </button>
      </div>

      {action.type === 'runMacro' && (
        <div className="border-t border-app-border/70 p-1.5">
          <MacroEditor
            steps={action.steps || []}
            onChange={(steps) => onChange({ ...action, steps })}
          />
        </div>
      )}
    </div>
  );
};