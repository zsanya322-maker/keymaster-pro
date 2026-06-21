import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { FrontendCondition } from '../../lib/types';
import { useProfileStore } from '../../store/profileStore';

interface ConditionEditorProps {
  condition: FrontendCondition;
  onChange: (condition: FrontendCondition) => void;
  onRemove: () => void;
}

export const ConditionEditor: React.FC<ConditionEditorProps> = ({ condition, onChange, onRemove }) => {
  const { t } = useTranslation();
  const { activeProfileId, profiles } = useProfileStore();
  const activeProfile = profiles.find((p) => p.id === activeProfileId);
  const layers = activeProfile?.layers || [];

  const [isCapturing, setIsCapturing] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  const handleCapture = () => {
    if (isCapturing) return;
    setIsCapturing(true);
    setCountdown(3);

    let currentCount = 3;
    const interval = setInterval(async () => {
      currentCount -= 1;
      setCountdown(currentCount);

      if (currentCount <= 0) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        try {
          const res = await invoke<{ process: string; title: string }>('ipc_call', { method: 'get_active_window' });
          if (condition.type === 'processActive' && res.process) {
            onChange({ type: 'processActive', process: res.process });
          } else if (condition.type === 'windowFocused' && res.title) {
            onChange({ type: 'windowFocused', title: res.title });
          } else if (condition.type === 'windowMatch') {
            // Заполняем оба поля — юзер потом решит что оставить пустым.
            onChange({
              type: 'windowMatch',
              process: res.process || '',
              title: res.title || '',
            });
          }
        } catch (e) {
          console.error('Failed to capture active window', e);
        } finally {
          setIsCapturing(false);
        }
      }
    }, 1000);

    intervalRef.current = interval;
  };

  return (
    <div className="flex gap-2 items-center bg-app-surface-hover/50 p-2 rounded border border-app-border">
      <select
        value={condition.type}
        onChange={(e) => {
          const type = e.target.value as any;
          if (type === 'processActive') {
            onChange({ type, process: '' } as FrontendCondition);
          } else if (type === 'windowFocused') {
            onChange({ type, title: '' } as FrontendCondition);
          } else if (type === 'layerActive') {
            onChange({ type, layerId: '' } as FrontendCondition);
          } else if (type === 'windowMatch') {
            onChange({ type, process: '', title: '' } as FrontendCondition);
          }
        }}
        className="bg-app-surface-hover border border-app-border text-xs text-app-text rounded p-1 w-32"
      >
        <option value="windowMatch">{t('ruleBuilder.condition_types.windowMatch')}</option>
        <option value="processActive">{t('ruleBuilder.condition_types.processActive')}</option>
        <option value="windowFocused">{t('ruleBuilder.condition_types.windowFocused')}</option>
        <option value="layerActive">{t('ruleBuilder.condition_types.layerActive')}</option>
      </select>

      {condition.type === 'processActive' && (
        <div className="flex gap-2 flex-grow">
          <input
            type="text"
            value={condition.process}
            onChange={(e) => onChange({ ...condition, process: e.target.value })}
            placeholder={t('ruleBuilder.placeholders.process')}
            className="bg-app-bg border border-app-border text-xs text-app-text rounded p-1 flex-1"
          />
          <button
            type="button"
            disabled={isCapturing}
            onClick={handleCapture}
            className={`px-2.5 py-1 text-white rounded text-[10px] font-semibold transition-all flex items-center gap-1 shrink-0 ${
              isCapturing 
                ? 'bg-amber-600 animate-pulse cursor-not-allowed shadow-inner' 
                : 'bg-app-primary hover:bg-app-primary/80 cursor-pointer shadow'
            }`}
            title={t('ruleBuilder.hints.capture_window', 'Захватить активное окно')}
          >
            {isCapturing ? (
              <>⏱️ {t('ruleBuilder.buttons.capturing', 'Захват через {{seconds}}...', { seconds: countdown })}</>
            ) : (
              <>📸 {t('ruleBuilder.buttons.capture', 'Захват')}</>
            )}
          </button>
        </div>
      )}

      {condition.type === 'windowFocused' && (
        <div className="flex gap-2 flex-grow">
          <input
            type="text"
            value={condition.title}
            onChange={(e) => onChange({ ...condition, title: e.target.value })}
            placeholder={t('ruleBuilder.placeholders.title', 'Заголовок окна')}
            className="bg-app-bg border border-app-border text-xs text-app-text rounded p-1 flex-1"
          />
          <button
            type="button"
            disabled={isCapturing}
            onClick={handleCapture}
            className={`px-2.5 py-1 text-white rounded text-[10px] font-semibold transition-all flex items-center gap-1 shrink-0 ${
              isCapturing 
                ? 'bg-amber-600 animate-pulse cursor-not-allowed shadow-inner' 
                : 'bg-app-primary hover:bg-app-primary/80 cursor-pointer shadow'
            }`}
            title={t('ruleBuilder.hints.capture_window', 'Захватить активное окно')}
          >
            {isCapturing ? (
              <>⏱️ {t('ruleBuilder.buttons.capturing', 'Захват через {{seconds}}...', { seconds: countdown })}</>
            ) : (
              <>📸 {t('ruleBuilder.buttons.capture', 'Захват')}</>
            )}
          </button>
        </div>
      )}

      {condition.type === 'windowMatch' && (
        <div className="flex gap-2 flex-grow flex-wrap">
          <input
            type="text"
            value={condition.process || ''}
            onChange={(e) => onChange({ ...condition, process: e.target.value })}
            placeholder={t('ruleBuilder.placeholders.process')}
            className="bg-app-bg border border-app-border text-xs text-app-text rounded p-1 flex-1 min-w-[100px]"
          />
          <input
            type="text"
            value={condition.title || ''}
            onChange={(e) => onChange({ ...condition, title: e.target.value })}
            placeholder={t('ruleBuilder.placeholders.title', 'Заголовок окна')}
            className="bg-app-bg border border-app-border text-xs text-app-text rounded p-1 flex-1 min-w-[100px]"
          />
          <button
            type="button"
            disabled={isCapturing}
            onClick={handleCapture}
            className={`px-2.5 py-1 text-white rounded text-[10px] font-semibold transition-all flex items-center gap-1 shrink-0 ${
              isCapturing
                ? 'bg-amber-600 animate-pulse cursor-not-allowed shadow-inner'
                : 'bg-app-primary hover:bg-app-primary/80 cursor-pointer shadow'
            }`}
            title={t('ruleBuilder.hints.capture_window', 'Захватить активное окно')}
          >
            {isCapturing ? (
              <>⏱️ {t('ruleBuilder.buttons.capturing', 'Захват через {{seconds}}...', { seconds: countdown })}</>
            ) : (
              <>📸 {t('ruleBuilder.buttons.capture', 'Захват')}</>
            )}
          </button>
          <span className="text-[10px] text-app-muted italic self-center w-full">
            {t('ruleBuilder.hints.windowMatch_or')}
          </span>
        </div>
      )}

      {condition.type === 'layerActive' && (
        layers.length === 0 ? (
          <span className="text-xs text-app-danger italic flex-1">
            {t('ruleBuilder.hints.create_layer_first')}
          </span>
        ) : (
          <select
            value={condition.layerId}
            onChange={(e) => onChange({ ...condition, layerId: e.target.value })}
            className="bg-app-bg border border-app-border text-xs text-app-text rounded p-1 flex-1 cursor-pointer"
          >
            {!condition.layerId && <option value="">{t('ruleBuilder.hints.select_layer')}</option>}
            {layers.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )
      )}

      <button
        onClick={onRemove}
        className="text-app-danger hover:text-red-400 p-1"
        title={t('ruleBuilder.remove_condition_tooltip')}
      >
        ✕
      </button>
    </div>
  );
};
