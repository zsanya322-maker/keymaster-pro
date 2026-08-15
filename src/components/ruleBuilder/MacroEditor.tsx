import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { ArrowDown, ArrowUp, Circle, Plus, Square, Trash2 } from 'lucide-react';
import type { MacroAction, MacroStep } from '../../lib/types';
import { KeyPicker } from './KeyPicker';

interface MacroEditorProps {
  steps: MacroStep[];
  onChange: (steps: MacroStep[]) => void;
}

const inputClass = 'h-7 border border-app-border bg-app-bg px-1.5 text-[11px] text-app-text outline-none focus:border-app-primary disabled:opacity-50';

export const MacroEditor: React.FC<MacroEditorProps> = ({ steps, onChange }) => {
  const { t } = useTranslation();
  const [isRecording, setIsRecording] = useState(false);
  const [recordedCount, setRecordedCount] = useState(0);
  const [recordMouseMoves, setRecordMouseMoves] = useState(false);
  const [recordMouseDragDropOnly, setRecordMouseDragDropOnly] = useState(true);

  const isRecordingRef = useRef(false);
  const recordMouseMovesRef = useRef(recordMouseMoves);
  const recordMouseDragDropOnlyRef = useRef(recordMouseDragDropOnly);
  const isStoppingRef = useRef(false);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    recordMouseMovesRef.current = recordMouseMoves;
  }, [recordMouseMoves]);

  useEffect(() => {
    recordMouseDragDropOnlyRef.current = recordMouseDragDropOnly;
  }, [recordMouseDragDropOnly]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const syncSettings = (ready: boolean, moves: boolean, dragDrop: boolean, currentSteps: MacroStep[] = []) => {
    invoke('ipc_call', {
      method: 'macro.set_record_ready',
      params: {
        ready,
        recordMouseMoves: moves,
        recordMouseDragDropOnly: dragDrop,
        existingSteps: currentSteps,
      },
    }).catch((error) => console.error('Failed to set macro recording options', error));
  };

  useEffect(() => {
    if (!isRecordingRef.current) {
      syncSettings(true, recordMouseMovesRef.current, recordMouseDragDropOnlyRef.current, steps);
    }
  }, [steps]);

  useEffect(() => {
    let disposed = false;
    let timerId: number | null = null;

    const poll = async () => {
      if (disposed) return;

      try {
        const result = await invoke<{ isRecording: boolean; stepsCount: number }>('ipc_call', {
          method: 'macro.get_recording_status',
        });
        if (disposed) return;

        setRecordedCount(result.stepsCount);
        const wasRecording = isRecordingRef.current;

        if (result.isRecording && !wasRecording) {
          isStoppingRef.current = false;
          isRecordingRef.current = true;
          setIsRecording(true);
        } else if (!result.isRecording && wasRecording && !isStoppingRef.current) {
          isRecordingRef.current = false;
          setIsRecording(false);
          const stepsResult = await invoke<{ steps: MacroStep[] }>('ipc_call', { method: 'macro.stop_recording' });
          if (!disposed && stepsResult.steps?.length) onChangeRef.current(stepsResult.steps);
        }
      } catch (error) {
        if (!disposed) console.error('Failed to poll macro recording status', error);
      }

      if (!disposed) {
        timerId = window.setTimeout(poll, isRecordingRef.current ? 250 : 1000);
      }
    };

    void poll();

    return () => {
      disposed = true;
      if (timerId !== null) window.clearTimeout(timerId);
      invoke('ipc_call', { method: 'macro.stop_recording' }).catch(() => {});
      syncSettings(false, recordMouseMovesRef.current, recordMouseDragDropOnlyRef.current, []);
    };
  }, []);

  const handleRecordMouseMovesChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.checked;
    setRecordMouseMoves(value);
    syncSettings(true, value, recordMouseDragDropOnly, steps);
  };

  const handleRecordMouseDragDropOnlyChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.checked;
    setRecordMouseDragDropOnly(value);
    syncSettings(true, recordMouseMoves, value, steps);
  };

  const handleStartRecording = async () => {
    try {
      await invoke('ipc_call', {
        method: 'macro.start_recording',
        params: {
          recordMouseMoves,
          recordMouseDragDropOnly,
          existingSteps: steps,
        },
      });
      isRecordingRef.current = true;
      setIsRecording(true);
      setRecordedCount(steps.length);
    } catch (error) {
      console.error('Failed to start recording', error);
    }
  };

  const handleStopRecording = async () => {
    isStoppingRef.current = true;
    try {
      const result = await invoke<{ steps: MacroStep[] }>('ipc_call', { method: 'macro.stop_recording' });
      isRecordingRef.current = false;
      setIsRecording(false);
      if (result.steps?.length) onChange(result.steps);
    } catch (error) {
      console.error('Failed to stop recording', error);
      isRecordingRef.current = false;
      setIsRecording(false);
    } finally {
      isStoppingRef.current = false;
    }
  };

  const updateStep = (index: number, patch: Partial<MacroStep>) => {
    const next = [...steps];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };

  const updateAction = (index: number, action: MacroAction) => updateStep(index, { action });

  const moveStep = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= steps.length) return;
    const next = [...steps];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    onChange(next);
  };

  const moveStepTo = (fromIndex: number, targetIndex: number) => {
    if (fromIndex < 0 || fromIndex >= steps.length || targetIndex < 0 || targetIndex >= steps.length || fromIndex === targetIndex) return;
    const next = [...steps];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(targetIndex, 0, moved);
    onChange(next);
  };

  const createDefaultAction = (type: MacroAction['type']): MacroAction => {
    if (type === 'mouseMove') return { type, dx: 0, dy: 0 };
    if (type === 'mouseScroll' || type === 'mouseHScroll') return { type, delta: 0 };
    if (type === 'mouseToAbsolute') return { type, x: 0, y: 0 };
    if (type === 'mouseDown' || type === 'mouseUp') return { type, code: 1 };
    return { type, code: 0 };
  };

  const renderActionFields = (action: MacroAction, index: number) => {
    switch (action.type) {
      case 'keyDown':
        return (
          <KeyPicker
            value={action.code}
            onChange={(code) => updateAction(index, { type: 'keyDown', code })}
            className="w-full min-w-0 text-left"
          />
        );
      case 'keyUp':
        return (
          <KeyPicker
            value={action.code}
            onChange={(code) => updateAction(index, { type: 'keyUp', code })}
            className="w-full min-w-0 text-left"
          />
        );
      case 'mouseDown':
        return (
          <select
            value={action.code}
            disabled={isRecording}
            onChange={(event) => updateAction(index, {
              type: 'mouseDown',
              code: Number.parseInt(event.target.value, 10) || 1,
            })}
            className={`${inputClass} w-full cursor-pointer`}
          >
            <option value="1">{t('ruleBuilder.action_options.mouse_left')}</option>
            <option value="2">{t('ruleBuilder.action_options.mouse_right')}</option>
            <option value="3">{t('ruleBuilder.action_options.mouse_middle')}</option>
            <option value="4">{t('ruleBuilder.action_options.mouse_x1')}</option>
            <option value="5">{t('ruleBuilder.action_options.mouse_x2')}</option>
          </select>
        );
      case 'mouseUp':
        return (
          <select
            value={action.code}
            disabled={isRecording}
            onChange={(event) => updateAction(index, {
              type: 'mouseUp',
              code: Number.parseInt(event.target.value, 10) || 1,
            })}
            className={`${inputClass} w-full cursor-pointer`}
          >
            <option value="1">{t('ruleBuilder.action_options.mouse_left')}</option>
            <option value="2">{t('ruleBuilder.action_options.mouse_right')}</option>
            <option value="3">{t('ruleBuilder.action_options.mouse_middle')}</option>
            <option value="4">{t('ruleBuilder.action_options.mouse_x1')}</option>
            <option value="5">{t('ruleBuilder.action_options.mouse_x2')}</option>
          </select>
        );
      case 'mouseMove':
        return (
          <>
            <span className="text-[10px] text-app-muted">dX</span>
            <input
              type="number"
              value={action.dx}
              disabled={isRecording}
              onChange={(event) => updateAction(index, {
                type: 'mouseMove',
                dx: Number.parseInt(event.target.value, 10) || 0,
                dy: action.dy,
              })}
              className={`${inputClass} flex-1 min-w-0 text-right font-mono`}
            />
            <span className="text-[10px] text-app-muted">dY</span>
            <input
              type="number"
              value={action.dy}
              disabled={isRecording}
              onChange={(event) => updateAction(index, {
                type: 'mouseMove',
                dx: action.dx,
                dy: Number.parseInt(event.target.value, 10) || 0,
              })}
              className={`${inputClass} flex-1 min-w-0 text-right font-mono`}
            />
          </>
        );
      case 'mouseScroll':
      case 'mouseHScroll':
        return (
          <>
            <span className="text-[10px] text-app-muted">Delta</span>
            <input
              type="number"
              value={action.delta}
              disabled={isRecording}
              onChange={(event) => updateAction(index, {
                type: action.type,
                delta: Number.parseInt(event.target.value, 10) || 0,
              })}
              className={`${inputClass} w-full text-right font-mono`}
            />
          </>
        );
      case 'mouseToAbsolute':
        return (
          <>
            <span className="text-[10px] text-app-muted">X</span>
            <input
              type="number"
              value={action.x}
              disabled={isRecording}
              onChange={(event) => updateAction(index, {
                type: 'mouseToAbsolute',
                x: Number.parseInt(event.target.value, 10) || 0,
                y: action.y,
              })}
              className={`${inputClass} flex-1 min-w-0 text-right font-mono`}
            />
            <span className="text-[10px] text-app-muted">Y</span>
            <input
              type="number"
              value={action.y}
              disabled={isRecording}
              onChange={(event) => updateAction(index, {
                type: 'mouseToAbsolute',
                x: action.x,
                y: Number.parseInt(event.target.value, 10) || 0,
              })}
              className={`${inputClass} flex-1 min-w-0 text-right font-mono`}
            />
          </>
        );
    }
  };

  return (
    <div className="border border-app-border bg-app-bg">
      <div className="min-h-9 px-2 flex items-center gap-2 border-b border-app-border bg-app-surface/35">
        <span className="text-[11px] font-semibold text-app-text">{t('macro.title')}</span>
        <span className="text-[10px] text-app-muted">F12 — {t('macro.f12_hint', 'запуск/остановка записи')}</span>

        <div className="ml-auto flex items-center gap-1.5 py-1">
          {isRecording ? (
            <button
              type="button"
              onClick={() => void handleStopRecording()}
              className="h-7 px-2 inline-flex items-center gap-1.5 border border-app-danger/60 bg-app-danger/10 text-[10px] font-medium text-app-danger hover:bg-app-danger/15"
            >
              <Square size={11} fill="currentColor" />
              {t('macro.stop')} ({recordedCount})
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleStartRecording()}
              className="h-7 px-2 inline-flex items-center gap-1.5 border border-app-border bg-app-surface text-[10px] font-medium text-app-text hover:bg-app-surface-hover"
            >
              <Circle size={11} className="text-app-danger" fill="currentColor" />
              {t('macro.record_keystrokes')}
            </button>
          )}
          <button
            type="button"
            onClick={() => onChange([...steps, { action: { type: 'keyDown', code: 0 }, delayMs: 50 }])}
            disabled={isRecording}
            className="h-7 px-2 inline-flex items-center gap-1 border border-app-border bg-app-surface text-[10px] text-app-text hover:bg-app-surface-hover disabled:opacity-40"
          >
            <Plus size={11} />
            {t('macro.add_step')}
          </button>
        </div>
      </div>

      <div className="min-h-8 px-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-app-border/60 bg-app-surface/15 text-[10px] text-app-text">
        <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={recordMouseMoves}
            disabled={isRecording}
            onChange={handleRecordMouseMovesChange}
            className="h-3.5 w-3.5 accent-app-primary"
          />
          {t('macro.record_mouse_moves', 'Записывать движения мыши')}
        </label>
        {recordMouseMoves && (
          <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={recordMouseDragDropOnly}
              disabled={isRecording}
              onChange={handleRecordMouseDragDropOnlyChange}
              className="h-3.5 w-3.5 accent-app-primary"
            />
            {t('macro.record_mouse_drag_drop_only', 'Только Drag-n-Drop')}
          </label>
        )}
      </div>

      {steps.length === 0 ? (
        <div className="px-3 py-6 text-center text-[11px] text-app-muted">
          {isRecording ? t('macro.empty_recording') : t('macro.empty_idle')}
        </div>
      ) : (
        <div className="max-h-[320px] overflow-y-auto select-none">
          {steps.map((step, index) => (
            <div
              key={index}
              draggable={!isRecording}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('application/x-keymaster-macro-step', String(index));
              }}
              onDragOver={(event) => {
                if (!isRecording) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }
              }}
              onDrop={(event) => {
                if (isRecording) return;
                event.preventDefault();
                const fromIndex = Number.parseInt(
                  event.dataTransfer.getData('application/x-keymaster-macro-step'),
                  10,
                );
                if (Number.isInteger(fromIndex)) moveStepTo(fromIndex, index);
              }}
              className={`min-h-10 px-1.5 py-1.5 flex items-center gap-1.5 border-b last:border-b-0 border-app-border/55 hover:bg-app-surface/20 ${isRecording ? '' : 'cursor-move'}`}
              title={isRecording ? undefined : t('macro.drag_reorder', { defaultValue: 'Перетащите для изменения порядка' })}
            >
              <div className="w-5 shrink-0 flex flex-col items-center">
                <button
                  type="button"
                  onClick={() => moveStep(index, -1)}
                  disabled={index === 0 || isRecording}
                  className="h-3.5 text-app-muted hover:text-app-text disabled:opacity-25"
                  title={t('common.move_up', 'Вверх')}
                >
                  <ArrowUp size={10} />
                </button>
                <button
                  type="button"
                  onClick={() => moveStep(index, 1)}
                  disabled={index === steps.length - 1 || isRecording}
                  className="h-3.5 text-app-muted hover:text-app-text disabled:opacity-25"
                  title={t('common.move_down', 'Вниз')}
                >
                  <ArrowDown size={10} />
                </button>
              </div>

              <span className="w-5 shrink-0 text-right font-mono text-[10px] text-app-muted">{index + 1}</span>

              <select
                value={step.action.type}
                disabled={isRecording}
                onChange={(event) => updateAction(index, createDefaultAction(event.target.value as MacroAction['type']))}
                className={`${inputClass} w-28 shrink-0 cursor-pointer`}
              >
                <option value="keyDown">{t('macro.step_types.keyDown')}</option>
                <option value="keyUp">{t('macro.step_types.keyUp')}</option>
                <option value="mouseDown">{t('macro.step_types.mouseDown')}</option>
                <option value="mouseUp">{t('macro.step_types.mouseUp')}</option>
                <option value="mouseMove">{t('macro.step_types.mouseMove_rel')}</option>
                <option value="mouseScroll">{t('macro.step_types.mouseScroll')}</option>
                <option value="mouseHScroll">{t('macro.step_types.mouseHScroll', { defaultValue: 'Гориз. колесо' })}</option>
                <option value="mouseToAbsolute">{t('macro.step_types.mouseMove_abs')}</option>
              </select>

              <div className="flex-1 min-w-0 flex items-center gap-1.5">
                {renderActionFields(step.action, index)}
              </div>

              <div className="w-20 shrink-0 flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  value={step.delayMs}
                  disabled={isRecording}
                  onChange={(event) => updateStep(index, { delayMs: Math.max(0, Number.parseInt(event.target.value, 10) || 0) })}
                  className={`${inputClass} w-full text-right font-mono`}
                  title={t('ruleBuilder.placeholders.delay')}
                />
                <span className="text-[9px] text-app-muted">ms</span>
              </div>

              <button
                type="button"
                onClick={() => onChange(steps.filter((_, itemIndex) => itemIndex !== index))}
                disabled={isRecording}
                className="h-7 w-7 shrink-0 inline-flex items-center justify-center text-app-muted hover:bg-app-surface hover:text-app-danger disabled:opacity-30"
                title={t('macro.remove_step_tooltip')}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
