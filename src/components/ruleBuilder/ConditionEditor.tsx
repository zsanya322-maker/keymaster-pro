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

type CapturedContext = {
  process: string;
  path: string;
  title: string;
  className: string;
  width: number;
  height: number;
  fullscreen: boolean;
  monitorId: string;
  virtualDesktopId: string;
};

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

  const captureNow = async () => {
    const result = await invoke<CapturedContext>('ipc_call', { method: 'get_active_window' });
    if (condition.type === 'windowMatch') {
      onChange({ type: 'windowMatch', process: result.process || '', title: result.title || '' });
      return;
    }
    if (condition.type === 'contextMatch') {
      onChange({
        ...condition,
        process: result.process || undefined,
        path: result.path || undefined,
        title: result.title || undefined,
        className: result.className || undefined,
        virtualDesktopId: result.virtualDesktopId || undefined,
        monitorId: result.monitorId || undefined,
        fullscreen: result.fullscreen,
      });
    }
  };

  const handleCapture = () => {
    if (isCapturing || (condition.type !== 'windowMatch' && condition.type !== 'contextMatch')) return;
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
        await captureNow();
      } catch (error) {
        console.error('Failed to capture active context', error);
      } finally {
        setIsCapturing(false);
      }
    }, 1000);
  };

  const captureButton = (
    <button
      type="button"
      disabled={isCapturing}
      onClick={handleCapture}
      className={`h-7 px-2 inline-flex items-center gap-1 border text-[10px] font-medium ${
        isCapturing
          ? 'border-amber-500/60 bg-amber-500/10 text-amber-500 cursor-not-allowed'
          : 'border-app-border bg-app-bg text-app-text hover:bg-app-surface'
      }`}
      title="Capture active context"
    >
      <Crosshair size={11} />
      {isCapturing
        ? t('ruleBuilder.buttons.capturing', { defaultValue: '{{seconds}}...', seconds: countdown })
        : t('ruleBuilder.buttons.capture', { defaultValue: 'Захват' })}
    </button>
  );

  return (
    <div className="border border-app-border/70 bg-app-bg">
      <div className="min-h-9 px-1.5 py-1 flex items-start gap-1.5">
        <select
          value={condition.type}
          onChange={(event) => {
            const type = event.target.value;
            if (type === 'layerActive') onChange({ type: 'layerActive', layerId: '' });
            else if (type === 'contextMatch') onChange({ type: 'contextMatch', mode: 'all' });
            else onChange({ type: 'windowMatch', process: '', title: '' });
          }}
          className={`${controlClass} w-[154px] shrink-0 cursor-pointer bg-app-surface/35`}
        >
          <option value="windowMatch">{t('ruleBuilder.condition_types.windowMatch')}</option>
          <option value="contextMatch">Context Match</option>
          <option value="layerActive">{t('ruleBuilder.condition_types.layerActive')}</option>
        </select>

        <div className="flex-1 min-w-0">
          {condition.type === 'windowMatch' && (
            <div className="grid grid-cols-[minmax(105px,1fr)_minmax(105px,1fr)_auto] gap-1.5 items-start">
              <input type="text" value={condition.process || ''} onChange={(event) => onChange({ ...condition, process: event.target.value })} placeholder={t('ruleBuilder.placeholders.process')} className={`${controlClass} min-w-0`} />
              <input type="text" value={condition.title || ''} onChange={(event) => onChange({ ...condition, title: event.target.value })} placeholder={t('ruleBuilder.placeholders.title', { defaultValue: 'Заголовок окна' })} className={`${controlClass} min-w-0`} />
              {captureButton}
              <div className="col-span-3 text-[9px] leading-4 text-app-muted">{t('ruleBuilder.hints.windowMatch_or')}</div>
            </div>
          )}

          {condition.type === 'contextMatch' && (
            <div className="space-y-1.5">
              <div className="grid grid-cols-[minmax(105px,1fr)_minmax(105px,1fr)_76px_auto] gap-1.5 items-start">
                <input className={controlClass} placeholder="process.exe" value={condition.process || ''} onChange={(event) => onChange({ ...condition, process: event.target.value || undefined })} />
                <input className={controlClass} placeholder="title contains" value={condition.title || ''} onChange={(event) => onChange({ ...condition, title: event.target.value || undefined })} />
                <select className={controlClass} value={condition.mode} onChange={(event) => onChange({ ...condition, mode: event.target.value as 'any' | 'all' })}>
                  <option value="all">ALL</option><option value="any">ANY</option>
                </select>
                {captureButton}
              </div>
              <details className="border border-app-border/60 bg-app-surface/20">
                <summary className="h-6 px-2 flex items-center cursor-pointer select-none text-[10px] text-app-muted">Дополнительно</summary>
                <div className="grid grid-cols-2 gap-1.5 p-1.5 border-t border-app-border/60">
                  <input className={controlClass} placeholder="path contains" value={condition.path || ''} onChange={(event) => onChange({ ...condition, path: event.target.value || undefined })} />
                  <input className={controlClass} placeholder="window class" value={condition.className || ''} onChange={(event) => onChange({ ...condition, className: event.target.value || undefined })} />
                  <input className={controlClass} placeholder="virtual desktop GUID" value={condition.virtualDesktopId || ''} onChange={(event) => onChange({ ...condition, virtualDesktopId: event.target.value || undefined })} />
                  <input className={controlClass} placeholder="monitor id" value={condition.monitorId || ''} onChange={(event) => onChange({ ...condition, monitorId: event.target.value || undefined })} />
                  <input className={controlClass} type="number" placeholder="min width" value={condition.minWidth ?? ''} onChange={(event) => onChange({ ...condition, minWidth: event.target.value ? Number(event.target.value) : undefined })} />
                  <input className={controlClass} type="number" placeholder="max width" value={condition.maxWidth ?? ''} onChange={(event) => onChange({ ...condition, maxWidth: event.target.value ? Number(event.target.value) : undefined })} />
                  <input className={controlClass} type="number" placeholder="min height" value={condition.minHeight ?? ''} onChange={(event) => onChange({ ...condition, minHeight: event.target.value ? Number(event.target.value) : undefined })} />
                  <input className={controlClass} type="number" placeholder="max height" value={condition.maxHeight ?? ''} onChange={(event) => onChange({ ...condition, maxHeight: event.target.value ? Number(event.target.value) : undefined })} />
                  <select className={`${controlClass} col-span-2`} value={condition.fullscreen === undefined ? 'any' : condition.fullscreen ? 'true' : 'false'} onChange={(event) => onChange({ ...condition, fullscreen: event.target.value === 'any' ? undefined : event.target.value === 'true' })}>
                    <option value="any">Window mode: any</option><option value="true">Fullscreen</option><option value="false">Windowed</option>
                  </select>
                </div>
              </details>
            </div>
          )}

          {condition.type === 'layerActive' && (
            layers.length === 0 ? (
              <div className="h-7 flex items-center text-[10px] text-app-danger">{t('ruleBuilder.hints.create_layer_first')}</div>
            ) : (
              <select value={condition.layerId} onChange={(event) => onChange({ ...condition, layerId: event.target.value })} className={`${controlClass} w-full cursor-pointer`}>
                {!condition.layerId && <option value="">{t('ruleBuilder.hints.select_layer')}</option>}
                {layers.map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}
              </select>
            )
          )}
        </div>

        <button type="button" onClick={onRemove} className="h-7 w-7 shrink-0 inline-flex items-center justify-center text-app-muted hover:bg-app-surface hover:text-app-danger" title={t('ruleBuilder.remove_condition_tooltip')}>
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
};
