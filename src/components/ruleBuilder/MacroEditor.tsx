import React, { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { MacroStep, MacroAction } from '../../lib/types';
import { KeyPicker } from './KeyPicker';
import { Trash2, ArrowUp, ArrowDown, Plus, Circle, Square } from 'lucide-react';

interface MacroEditorProps {
  steps: MacroStep[];
  onChange: (steps: MacroStep[]) => void;
}

export const MacroEditor: React.FC<MacroEditorProps> = ({ steps, onChange }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordedCount, setRecordedCount] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Check initial status on mount
    const checkStatus = async () => {
      try {
        const res = await invoke<{ isRecording: boolean; stepsCount: number }>('ipc_call', {
          method: 'macro.get_recording_status',
        });
        setIsRecording(res.isRecording);
        setRecordedCount(res.stepsCount);
      } catch (e) {
        console.error('Failed to get recording status', e);
      }
    };
    checkStatus();

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  // Poll status while recording
  useEffect(() => {
    if (isRecording) {
      intervalRef.current = setInterval(async () => {
        try {
          const res = await invoke<{ isRecording: boolean; stepsCount: number }>('ipc_call', {
            method: 'macro.get_recording_status',
          });
          setRecordedCount(res.stepsCount);
          if (!res.isRecording) {
            setIsRecording(false);
            if (intervalRef.current) clearInterval(intervalRef.current);
          }
        } catch (e) {
          console.error('Failed to poll recording status', e);
        }
      }, 500);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isRecording]);

  const handleStartRecording = async () => {
    try {
      await invoke('ipc_call', { method: 'macro.start_recording' });
      setIsRecording(true);
      setRecordedCount(0);
    } catch (e) {
      console.error('Failed to start recording', e);
    }
  };

  const handleStopRecording = async () => {
    try {
      const res = await invoke<{ steps: MacroStep[] }>('ipc_call', { method: 'macro.stop_recording' });
      setIsRecording(false);
      if (res.steps && res.steps.length > 0) {
        onChange(res.steps);
      }
    } catch (e) {
      console.error('Failed to stop recording', e);
      setIsRecording(false);
    }
  };

  const handleAddStep = () => {
    const newStep: MacroStep = {
      action: { type: 'keyDown', code: 0 },
      delayMs: 50,
    };
    onChange([...steps, newStep]);
  };

  const handleRemoveStep = (index: number) => {
    onChange(steps.filter((_, i) => i !== index));
  };

  const handleUpdateStepAction = (index: number, newAction: MacroAction) => {
    const updated = [...steps];
    updated[index] = {
      ...updated[index],
      action: newAction,
    };
    onChange(updated);
  };

  const handleUpdateStepDelay = (index: number, delayMs: number) => {
    const updated = [...steps];
    updated[index] = {
      ...updated[index],
      delayMs: Math.max(0, delayMs),
    };
    onChange(updated);
  };

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const updated = [...steps];
    const temp = updated[index];
    updated[index] = updated[index - 1];
    updated[index - 1] = temp;
    onChange(updated);
  };

  const handleMoveDown = (index: number) => {
    if (index === steps.length - 1) return;
    const updated = [...steps];
    const temp = updated[index];
    updated[index] = updated[index + 1];
    updated[index + 1] = temp;
    onChange(updated);
  };

  return (
    <div className="space-y-4 border border-app-border rounded-lg p-4 bg-app-bg/30">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-app-muted uppercase tracking-wider">Macro Steps</span>
        <div className="flex gap-2">
          {isRecording ? (
            <button
              type="button"
              onClick={handleStopRecording}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors shadow-md cursor-pointer animate-pulse"
            >
              <Square size={12} fill="white" />
              Stop ({recordedCount})
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStartRecording}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-app-primary text-white rounded-lg hover:bg-app-primary/80 transition-colors shadow-md cursor-pointer"
            >
              <Circle size={12} fill="white" className="text-red-500" />
              Record Keystrokes
            </button>
          )}
          <button
            type="button"
            onClick={handleAddStep}
            disabled={isRecording}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-app-surface border border-app-border text-app-text rounded-lg hover:bg-app-surface-hover transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus size={12} />
            Add Step
          </button>
        </div>
      </div>

      {steps.length === 0 ? (
        <div className="text-center py-8 border border-dashed border-app-border rounded-lg bg-app-bg/10">
          <p className="text-xs text-app-muted">
            {isRecording
              ? 'Recording in progress... Type keys to record steps.'
              : 'No steps in macro. Click "Record Keystrokes" or add them manually.'}
          </p>
        </div>
      ) : (
        <div className="max-h-[300px] overflow-y-auto space-y-2 pr-1 select-none">
          {steps.map((step, index) => {
            return (
              <div
                key={index}
                className="flex items-center gap-2 bg-app-surface/40 hover:bg-app-surface/60 p-2 rounded-lg border border-app-border/60 transition-colors text-xs text-app-text"
              >
                {/* Reorder controls */}
                <div className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={() => handleMoveUp(index)}
                    disabled={index === 0 || isRecording}
                    className="p-0.5 text-app-muted hover:text-app-text disabled:opacity-30 disabled:hover:text-app-muted cursor-pointer"
                  >
                    <ArrowUp size={11} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMoveDown(index)}
                    disabled={index === steps.length - 1 || isRecording}
                    className="p-0.5 text-app-muted hover:text-app-text disabled:opacity-30 disabled:hover:text-app-muted cursor-pointer"
                  >
                    <ArrowDown size={11} />
                  </button>
                </div>

                {/* Step Index Label */}
                <span className="w-5 text-center text-app-muted font-mono font-bold">
                  {index + 1}
                </span>

                {/* Action Type Dropdown */}
                <select
                  value={step.action.type}
                  disabled={isRecording}
                  onChange={(e) => {
                    const newType = e.target.value as MacroAction['type'];
                    let defaultAction: MacroAction;
                    if (newType === 'mouseMove') {
                      defaultAction = { type: 'mouseMove', dx: 0, dy: 0 };
                    } else if (newType === 'mouseScroll') {
                      defaultAction = { type: 'mouseScroll', delta: 0 };
                    } else if (newType === 'mouseToAbsolute') {
                      defaultAction = { type: 'mouseToAbsolute', x: 0, y: 0 };
                    } else if (newType === 'mouseDown' || newType === 'mouseUp') {
                      defaultAction = { type: newType, code: 1 };
                    } else {
                      defaultAction = { type: newType, code: 0 } as any;
                    }
                    handleUpdateStepAction(index, defaultAction);
                  }}
                  className="bg-app-bg border border-app-border text-xs text-app-text rounded p-1 w-28 cursor-pointer disabled:opacity-50"
                >
                  <option value="keyDown">Key Down</option>
                  <option value="keyUp">Key Up</option>
                  <option value="mouseDown">Mouse Down</option>
                  <option value="mouseUp">Mouse Up</option>
                  <option value="mouseMove">Mouse Move (Rel)</option>
                  <option value="mouseScroll">Mouse Scroll</option>
                  <option value="mouseToAbsolute">Mouse Move (Abs)</option>
                </select>

                {/* Target input: KeyPicker, Mouse Dropdown or coordinates */}
                <div className="flex-1 flex items-center min-w-0 gap-2">
                  {step.action.type === 'mouseMove' && (
                    <div className="flex items-center gap-1.5 w-full">
                      <span className="text-[10px] text-app-muted font-mono font-semibold">dX:</span>
                      <input
                        type="number"
                        value={step.action.dx}
                        disabled={isRecording}
                        onChange={(e) =>
                          handleUpdateStepAction(index, {
                            ...step.action,
                            dx: parseInt(e.target.value) || 0,
                          } as any)
                        }
                        className="bg-app-bg border border-app-border text-xs text-app-text rounded p-1 w-full text-right font-mono disabled:opacity-50"
                      />
                      <span className="text-[10px] text-app-muted font-mono font-semibold">dY:</span>
                      <input
                        type="number"
                        value={step.action.dy}
                        disabled={isRecording}
                        onChange={(e) =>
                          handleUpdateStepAction(index, {
                            ...step.action,
                            dy: parseInt(e.target.value) || 0,
                          } as any)
                        }
                        className="bg-app-bg border border-app-border text-xs text-app-text rounded p-1 w-full text-right font-mono disabled:opacity-50"
                      />
                    </div>
                  )}

                  {step.action.type === 'mouseScroll' && (
                    <div className="flex items-center gap-1.5 w-full">
                      <span className="text-[10px] text-app-muted font-mono font-semibold">Delta:</span>
                      <input
                        type="number"
                        value={step.action.delta}
                        disabled={isRecording}
                        onChange={(e) =>
                          handleUpdateStepAction(index, {
                            ...step.action,
                            delta: parseInt(e.target.value) || 0,
                          } as any)
                        }
                        placeholder="e.g. 120 or -120"
                        className="bg-app-bg border border-app-border text-xs text-app-text rounded p-1 w-full text-right font-mono disabled:opacity-50"
                      />
                    </div>
                  )}

                  {step.action.type === 'mouseToAbsolute' && (
                    <div className="flex items-center gap-1.5 w-full">
                      <span className="text-[10px] text-app-muted font-mono font-semibold">X:</span>
                      <input
                        type="number"
                        value={step.action.x}
                        disabled={isRecording}
                        onChange={(e) =>
                          handleUpdateStepAction(index, {
                            ...step.action,
                            x: parseInt(e.target.value) || 0,
                          } as any)
                        }
                        className="bg-app-bg border border-app-border text-xs text-app-text rounded p-1 w-full text-right font-mono disabled:opacity-50"
                      />
                      <span className="text-[10px] text-app-muted font-mono font-semibold">Y:</span>
                      <input
                        type="number"
                        value={step.action.y}
                        disabled={isRecording}
                        onChange={(e) =>
                          handleUpdateStepAction(index, {
                            ...step.action,
                            y: parseInt(e.target.value) || 0,
                          } as any)
                        }
                        className="bg-app-bg border border-app-border text-xs text-app-text rounded p-1 w-full text-right font-mono disabled:opacity-50"
                      />
                    </div>
                  )}

                  {(step.action.type === 'mouseDown' || step.action.type === 'mouseUp') && (
                    <select
                      value={step.action.code}
                      disabled={isRecording}
                      onChange={(e) =>
                        handleUpdateStepAction(index, {
                          ...step.action,
                          code: parseInt(e.target.value) || 1,
                        } as any)
                      }
                      className="bg-app-bg border border-app-border text-xs text-app-text rounded p-1 w-full cursor-pointer disabled:opacity-50"
                    >
                      <option value="1">Left Button (1)</option>
                      <option value="2">Right Button (2)</option>
                      <option value="3">Middle Button (3)</option>
                      <option value="4">X1 Button (4)</option>
                      <option value="5">X2 Button (5)</option>
                    </select>
                  )}

                  {(step.action.type === 'keyDown' || step.action.type === 'keyUp') && (
                    <KeyPicker
                      value={step.action.code}
                      onChange={(vk) =>
                        handleUpdateStepAction(index, {
                          ...step.action,
                          code: vk,
                        } as any)
                      }
                      className="w-full text-left"
                    />
                  )}
                </div>

                {/* Delay Input */}
                <div className="flex items-center gap-1 w-20 shrink-0">
                  <input
                    type="number"
                    value={step.delayMs}
                    disabled={isRecording}
                    onChange={(e) => handleUpdateStepDelay(index, parseInt(e.target.value) || 0)}
                    placeholder="Delay"
                    className="bg-app-bg border border-app-border text-xs text-app-text rounded p-1 w-full text-right font-mono disabled:opacity-50"
                  />
                  <span className="text-[10px] text-app-muted font-semibold">ms</span>
                </div>

                {/* Remove step button */}
                <button
                  type="button"
                  onClick={() => handleRemoveStep(index)}
                  disabled={isRecording}
                  className="p-1 text-app-danger hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer shrink-0"
                  title="Remove Step"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
