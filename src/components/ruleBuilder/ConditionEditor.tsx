import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { AlertTriangle, Crosshair, Trash2 } from 'lucide-react';
import type { FrontendCondition } from '../../lib/types';
import { useProfileStore } from '../../store/profileStore';

interface ConditionEditorProps {
  condition: FrontendCondition;
  onChange: (condition: FrontendCondition) => void;
  onRemove: () => void;
}

const controlClass = 'h-7 border border-app-border bg-app-bg px-2 text-[11px] text-app-text outline-none focus:border-app-primary';

export const ConditionEditor: React.FC<ConditionEditorProps> = ({ condition, onChange, onRemove }) => {
  const { t } = useTranslation();
  const { activeProfileId, profiles } = useProfileStore();
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId);
  const layers = activeProfile?.layers || [];

  const [isCapturing, setIsCapturing] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
  }, []);

  const handleCapture = () => {
    if (isCapturing || condition.type !== 'windowMatch') return;

    setIsCapturing(true);
    setCountdown(3);
    let currentCount = 3;

    intervalRef.current = setInterval(async () => {
      currentCount -= 1;
      setCountdown(currentCount);
      if (currentCount > 0) return;

      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }

      try {
        const result = await invoke<{ process: string; title: string }>('ipc_call', { method: 'get_active_window' });
        onChange({
          type: 'windowMatch',
          process: result.process || '',
          title: result.title || '',
        });
      } catch (error) {
        console.error('Failed to capture active window', error);
      } finally {
        setIsCapturing(false);
      }
    }, 1000);
  };

  return (
    <div className="border border-app-border/70 bg-app-bg">
      <div className="min-h-9 px-1.5 py-1 flex items-start gap-1.5">
        <select
          value={condition.type}
          onChange={(event) => {
            const type = event.target.value;
            if (type === 'layerActive') onChange({ type: 'layerActive', layerId: '' });
            else onChange({ type: 'windowMatch', process: '', title: '' });
          }}
          className={`${controlClass} w-[154px] shrink-0 cursor-pointer bg-app-surface/35`}
        >
          <option value="windowMatch">{t('ruleBuilder.condition_types.windowMatch')}</option>
          <option value="layerActive">{t('ruleBuilder.condition_types.layerActive')}</option>
          {condition.type === 'virtualDesktop' && (
            <option value="virtualDesktop" disabled>
              {t('ruleBuilder.condition_types.virtualDesktop', { defaultValue: 'Виртуальный рабочий стол' })}
            </option>
          )}
        </select>

        <div className="flex-1 min-w-0">
          {condition.type === 'windowMatch' && (
            <div className="grid grid-cols-[minmax(105px,1fr)_minmax(105px,1fr)_auto] gap-1.5 items-start">
              <input
                type="text"
                value={condition.process || ''}
                onChange={(event) => onChange({ ...condition, process: event.target.value })}
                placeholder={t('ruleBuilder.placeholders.process')}
                className={`${controlClass} min-w-0`}
              />
              <input
                type="text"
                value={condition.title || ''}
                onChange={(event) => onChange({ ...condition, title: event.target.value })}
                placeholder={t('ruleBuilder.placeholders.title', { defaultValue: 'Заголовок окна' })}
                className={`${controlClass} min-w-0`}
              />
              <button
                type="button"
                disabled={isCapturing}
                onClick={handleCapture}
                className={`h-7 px-2 inline-flex items-center gap-1 border text-[10px] font-medium ${
                  isCapturing
                    ? 'border-amber-500/60 bg-amber-500/10 text-amber-500 cursor-not-allowed'
                    : 'border-app-border bg-app-bg text-app-text hover:bg-app-surface'
                }`}
                title={t('ruleBuilder.hints.capture_window', { defaultValue: 'Захватить активное окно' })}
              >
                <Crosshair size={11} />
                {isCapturing
                  ? t('ruleBuilder.buttons.capturing', { defaultValue: '{{seconds}}...', seconds: countdown })
                  : t('ruleBuilder.buttons.capture', { defaultValue: 'Захват' })}
              </button>
              <div className="col-span-3 text-[9px] leading-4 text-app-muted">
                {t('ruleBuilder.hints.windowMatch_or')}
              </div>
            </div>
          )}

          {condition.type === 'layerActive' && (
            layers.length === 0 ? (
              <div className="h-7 flex items-center text-[10px] text-app-danger">
                {t('ruleBuilder.hints.create_layer_first')}
              </div>
            ) : (
              <select
                value={condition.layerId}
                onChange={(event) => onChange({ ...condition, layerId: event.target.value })}
                className={`${controlClass} w-full cursor-pointer`}
              >
                {!condition.layerId && <option value="">{t('ruleBuilder.hints.select_layer')}</option>}
                {layers.map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}
              </select>
            )
          )}

          {condition.type === 'virtualDesktop' && (
            <div className="min-h-7 flex items-center gap-2 border border-app-warning/40 bg-app-warning/5 px-2 text-[10px] text-app-warning">
              <AlertTriangle size={12} className="shrink-0" />
              <span>{t('ruleBuilder.hints.virtual_desktop_unsupported')}</span>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onRemove}
          className="h-7 w-7 shrink-0 inline-flex items-center justify-center text-app-muted hover:bg-app-surface hover:text-app-danger"
          title={t('ruleBuilder.remove_condition_tooltip')}
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
};
