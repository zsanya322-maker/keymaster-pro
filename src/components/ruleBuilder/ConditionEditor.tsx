import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { Crosshair, Trash2 } from 'lucide-react';
import type { FrontendCondition } from '../../lib/types';
import { useProfileStore } from '../../store/profileStore';

interface ConditionEditorProps {
  condition: FrontendCondition;
  onChange: (condition: FrontendCondition) => void;
  onRemove: () => void;
}

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
    <div className="border border-app-border bg-app-bg">
      <div className="min-h-10 px-2 py-1.5 flex items-start gap-2">
        <select
          value={condition.type}
          onChange={(event) => {
            const type = event.target.value as FrontendCondition['type'];
            if (type === 'layerActive') {
              onChange({ type, layerId: '' });
            } else if (type === 'virtualDesktop') {
              onChange({ type, id: 0 });
            } else {
              onChange({ type: 'windowMatch', process: '', title: '' });
            }
          }}
          className="h-7 w-36 shrink-0 border border-app-border bg-app-surface/55 px-1.5 text-[11px] text-app-text outline-none focus:border-app-primary"
        >
          <option value="windowMatch">{t('ruleBuilder.condition_types.windowMatch')}</option>
          <option value="layerActive">{t('ruleBuilder.condition_types.layerActive')}</option>
          <option value="virtualDesktop">{t('ruleBuilder.condition_types.virtualDesktop', 'Виртуальный рабочий стол')}</option>
        </select>

        <div className="flex-1 min-w-0">
          {condition.type === 'windowMatch' && (
            <div className="grid grid-cols-[minmax(110px,1fr)_minmax(110px,1fr)_auto] gap-1.5 items-start">
              <input
                type="text"
                value={condition.process || ''}
                onChange={(event) => onChange({ ...condition, process: event.target.value })}
                placeholder={t('ruleBuilder.placeholders.process')}
                className="h-7 min-w-0 border border-app-border bg-app-bg px-2 text-[11px] text-app-text outline-none focus:border-app-primary"
              />
              <input
                type="text"
                value={condition.title || ''}
                onChange={(event) => onChange({ ...condition, title: event.target.value })}
                placeholder={t('ruleBuilder.placeholders.title', 'Заголовок окна')}
                className="h-7 min-w-0 border border-app-border bg-app-bg px-2 text-[11px] text-app-text outline-none focus:border-app-primary"
              />
              <button
                type="button"
                disabled={isCapturing}
                onClick={handleCapture}
                className={`h-7 px-2 inline-flex items-center gap-1.5 border text-[10px] font-medium ${
                  isCapturing
                    ? 'border-amber-500/60 bg-amber-500/10 text-amber-500 cursor-not-allowed'
                    : 'border-app-border bg-app-surface text-app-text hover:bg-app-surface-hover'
                }`}
                title={t('ruleBuilder.hints.capture_window', 'Захватить активное окно')}
              >
                <Crosshair size={11} />
                {isCapturing
                  ? t('ruleBuilder.buttons.capturing', 'Захват через {{seconds}}...', { seconds: countdown })
                  : t('ruleBuilder.buttons.capture', 'Захват')}
              </button>
              <div className="col-span-3 text-[10px] leading-4 text-app-muted">
                {t('ruleBuilder.hints.windowMatch_or')}
              </div>
            </div>
          )}

          {condition.type === 'layerActive' && (
            layers.length === 0 ? (
              <div className="h-7 flex items-center text-[11px] text-app-danger">
                {t('ruleBuilder.hints.create_layer_first')}
              </div>
            ) : (
              <select
                value={condition.layerId}
                onChange={(event) => onChange({ ...condition, layerId: event.target.value })}
                className="h-7 w-full border border-app-border bg-app-bg px-2 text-[11px] text-app-text outline-none focus:border-app-primary"
              >
                {!condition.layerId && <option value="">{t('ruleBuilder.hints.select_layer')}</option>}
                {layers.map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}
              </select>
            )
          )}

          {condition.type === 'virtualDesktop' && (
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                step={1}
                value={condition.id}
                onChange={(event) => onChange({
                  type: 'virtualDesktop',
                  id: Math.max(0, Number.parseInt(event.target.value, 10) || 0),
                })}
                className="h-7 w-24 border border-app-border bg-app-bg px-2 text-[11px] font-mono text-app-text outline-none focus:border-app-primary"
              />
              <span className="text-[10px] text-app-muted">
                {t('ruleBuilder.hints.virtual_desktop_id', 'ID рабочего стола')}
              </span>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onRemove}
          className="h-7 w-7 shrink-0 inline-flex items-center justify-center border border-transparent text-app-muted hover:border-app-border hover:bg-app-surface hover:text-app-danger"
          title={t('ruleBuilder.remove_condition_tooltip')}
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
};
