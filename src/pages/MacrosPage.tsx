import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { useProfileStore } from '../store/profileStore';
import { useMacroStore, Macro, MacroStep, MacroActionType } from '../store/macroStore';
import { PlaySquare, Plus, Trash2, Video, Keyboard, MousePointer, Clock, StopCircle, AlertCircle, GripVertical, Target } from 'lucide-react';
import { triggerToast } from '../lib/toast';

export const MacrosPage: React.FC = () => {
  const { t } = useTranslation();
  const activeProfileId = useProfileStore((state) => state.activeProfileId);
  const { macros, addMacro, deleteMacro, updateMacro, loadMacros } = useMacroStore();
  const [selectedMacroId, setSelectedMacroId] = useState<string | null>(null);

  const getTriggerDescription = (macro: Macro) => {
    if (!macro.triggerKey || macro.triggerKey === 'Не назначено' || macro.triggerKey.toLowerCase() === 'not assigned') {
      return t('macros.not_assigned', 'Не назначено');
    }
    let desc = macro.triggerKey;
    if (macro.triggerLayout && macro.triggerLayout !== 'any') {
      desc += ` [${macro.triggerLayout.toUpperCase()}]`;
    }
    if (macro.triggerType === 'double_press') {
      desc = `${t('macros.trigger_modal.type_double', 'Двойное нажатие')}: ${desc} (${macro.triggerTime || 300}${t('macros.ms', 'мс')})`;
    } else if (macro.triggerType === 'long_press') {
      desc = `${t('macros.trigger_modal.type_long', 'Длинное нажатие')}: ${desc} (${macro.triggerTime || 450}${t('macros.ms', 'мс')})`;
    }
    return desc;
  };

  const [isRecording, setIsRecording] = useState(false);
  const [isTriggerModalOpen, setIsTriggerModalOpen] = useState(false);
  const [tempTriggerKey, setTempTriggerKey] = useState('');
  const [tempTriggerType, setTempTriggerType] = useState<'single' | 'double_press' | 'long_press'>('single');
  const [tempTriggerTime, setTempTriggerTime] = useState(300);
  const [tempTriggerLayout, setTempTriggerLayout] = useState<'any' | 'en' | 'ru'>('any');
  const [tempCapturing, setTempCapturing] = useState(false);
  const [capturingStepId, setCapturingStepId] = useState<string | null>(null);

  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [isCapturingWindow, setIsCapturingWindow] = useState(false);
  const [captureCountdown, setCaptureCountdown] = useState(0);

  useEffect(() => {
    if (activeProfileId) loadMacros(activeProfileId);
  }, [activeProfileId, loadMacros]);

  // Global mouseup to stop dragging
  useEffect(() => {
    if (draggedIndex === null) return;
    const handleMouseUp = () => {
      setDraggedIndex(null);
    };
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [draggedIndex]);

  const activeMacros = macros.filter((m) => m.profileId === activeProfileId);
  const selectedMacro = activeMacros.find((m) => m.id === selectedMacroId);

  const handleHandleMouseDown = (index: number) => {
    if (isRecording || capturingStepId) return;
    setDraggedIndex(index);
  };

  const handleCardMouseEnter = (targetIndex: number) => {
    if (draggedIndex === null || draggedIndex === targetIndex || !selectedMacro) return;
    const newSteps = [...selectedMacro.steps];
    const [draggedItem] = newSteps.splice(draggedIndex, 1);
    newSteps.splice(targetIndex, 0, draggedItem);
    updateMacro(selectedMacro.id, { steps: newSteps });
    setDraggedIndex(targetIndex);
  };

  const captureActiveWindow = async () => {
    if (isCapturingWindow || !selectedMacroId) return;
    setIsCapturingWindow(true);
    setCaptureCountdown(3);

    const timer = setInterval(() => {
      setCaptureCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    try {
      const res: any = await invoke('ipc_call', {
        method: 'macro.capture_active_window',
        params: { delay: 3 }
      });
      if (res && res.process) {
        updateMacro(selectedMacroId, { targetApp: res.process });
      }
    } catch (err) {
      triggerToast('Failed to auto-capture active window', 'error');
    } finally {
      clearInterval(timer);
      setIsCapturingWindow(false);
      setCaptureCountdown(0);
    }
  };

  // Synchronize selected macro for recording with backend
  useEffect(() => {
    if (selectedMacroId) {
      invoke('ipc_call', { method: 'macro.select_for_recording', params: { macroId: selectedMacroId } })
        .catch(() => triggerToast('Failed to select macro for recording', 'error'));
    } else {
      invoke('ipc_call', { method: 'macro.select_for_recording', params: { macroId: null } })
        .catch(() => triggerToast('Failed to reset macro selection', 'error'));
    }
  }, [selectedMacroId]);

  // Poll recording status from backend daemon
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res: any = await invoke('ipc_call', { method: 'macro.get_recording_status', params: {} });
        if (res) {
          setIsRecording(res.isRecording);
          
          if (res.isRecording && res.steps && selectedMacroId) {
            useMacroStore.setState((state) => ({
              macros: state.macros.map((m) => (m.id === selectedMacroId ? { ...m, steps: res.steps } : m))
            }));
          }
          
          // If backend recording stopped and we were recording, reload macros to get the recorded steps!
          if (!res.isRecording && isRecording) {
            if (activeProfileId) {
              loadMacros(activeProfileId);
            }
          }
        }
      } catch (err) {
        // Silent error during startup/shutdown
      }
    }, 300);

    return () => clearInterval(interval);
  }, [isRecording, selectedMacroId, activeProfileId, loadMacros]);

  // Capture temp trigger key inside modal
  useEffect(() => {
    if (!tempCapturing) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Escape key resets the trigger key
      if (e.key === 'Escape' || e.code === 'Escape') {
        setTempTriggerKey('Не назначено');
        setTempCapturing(false);
        return;
      }

      // Ignore modifier keydowns so they do not terminate capturing early
      const isModifier = ['Control', 'Shift', 'Alt', 'Meta', 'Ctrl', 'AltGraph'].includes(e.key) || 
                         ['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(e.code);
      if (isModifier) {
        return;
      }

      let keyLabel = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      if (e.code === 'Space') keyLabel = 'Space';
      if (e.code === 'ControlLeft' || e.code === 'ControlRight') keyLabel = 'Ctrl';
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keyLabel = 'Shift';
      if (e.code === 'AltLeft' || e.code === 'AltRight') keyLabel = 'Alt';
      if (e.code === 'MetaLeft' || e.code === 'MetaRight') keyLabel = 'Win';

      const modifiers = [];
      if (e.ctrlKey && keyLabel !== 'Ctrl') modifiers.push('Ctrl');
      if (e.shiftKey && keyLabel !== 'Shift') modifiers.push('Shift');
      if (e.altKey && keyLabel !== 'Alt') modifiers.push('Alt');
      if (e.metaKey && keyLabel !== 'Win') modifiers.push('Win');

      const finalKey = [...modifiers, keyLabel].join('+');

      setTempTriggerKey(finalKey);
      setTempCapturing(false);
    };

    const handleMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Ignore left (0) and right (2) mouse clicks to prevent lockouts
      if (e.button === 0 || e.button === 2) {
        return;
      }

      let btnName = '';
      if (e.button === 1) btnName = 'middle';
      else if (e.button === 3) btnName = 'xbutton1';
      else if (e.button === 4) btnName = 'xbutton2';

      if (btnName) {
        const capitalized = btnName.charAt(0).toUpperCase() + btnName.slice(1);
        
        // Capture modifiers held during mouse click
        const modifiers = [];
        if (e.ctrlKey) modifiers.push('Ctrl');
        if (e.shiftKey) modifiers.push('Shift');
        if (e.altKey) modifiers.push('Alt');
        if (e.metaKey) modifiers.push('Win');
        
        const finalKey = [...modifiers, capitalized].join('+');
        setTempTriggerKey(finalKey);
        setTempCapturing(false);
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    window.addEventListener('mousedown', handleMouseDown, { capture: true });
    window.addEventListener('contextmenu', handleContextMenu, { capture: true });

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      window.removeEventListener('mousedown', handleMouseDown, { capture: true });
      window.removeEventListener('contextmenu', handleContextMenu, { capture: true });
    };
  }, [tempCapturing]);

  const openTriggerModal = (macro: Macro) => {
    setTempTriggerKey(macro.triggerKey);
    setTempTriggerType(macro.triggerType || 'single');
    setTempTriggerTime(macro.triggerTime || (macro.triggerType === 'long_press' ? 450 : 300));
    setTempTriggerLayout(macro.triggerLayout || 'any');
    setTempCapturing(false);
    setIsTriggerModalOpen(true);
  };

  const handleSaveTrigger = () => {
    if (selectedMacroId) {
      updateMacro(selectedMacroId, {
        triggerKey: tempTriggerKey,
        triggerType: tempTriggerType,
        triggerTime: tempTriggerTime,
        triggerLayout: tempTriggerLayout,
      });
    }
    setIsTriggerModalOpen(false);
  };

  // Step key capturing
  useEffect(() => {
    if (!capturingStepId || !selectedMacro) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      let keyLabel = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      if (e.code === 'Space') keyLabel = 'Space';
      if (e.code === 'ControlLeft' || e.code === 'ControlRight') keyLabel = 'Ctrl';
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keyLabel = 'Shift';
      if (e.code === 'AltLeft' || e.code === 'AltRight') keyLabel = 'Alt';
      if (e.code === 'MetaLeft' || e.code === 'MetaRight') keyLabel = 'Win';

      const modifiers = [];
      if (e.ctrlKey && keyLabel !== 'Ctrl') modifiers.push('Ctrl');
      if (e.shiftKey && keyLabel !== 'Shift') modifiers.push('Shift');
      if (e.altKey && keyLabel !== 'Alt') modifiers.push('Alt');
      if (e.metaKey && keyLabel !== 'Win') modifiers.push('Win');

      const finalKey = [...modifiers, keyLabel].join('+');

      const newSteps = selectedMacro.steps.map(s => s.id === capturingStepId ? { ...s, value: finalKey } : s);
      updateMacro(selectedMacro.id, { steps: newSteps });
      setCapturingStepId(null);
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [capturingStepId, selectedMacro]);

  const handleCreate = () => {
    if (!activeProfileId) return;
    const newMacro: Macro = {
      id: Date.now().toString(),
      profileId: activeProfileId,
      name: t('profiles.new_profile_default'),
      triggerKey: 'Не назначено',
      steps: [],
    };
    addMacro(newMacro);
    setSelectedMacroId(newMacro.id);
  };

  useEffect(() => {
    const handleAddRule = () => {
      handleCreate();
    };
    window.addEventListener('keymaster-add-rule', handleAddRule);
    return () => window.removeEventListener('keymaster-add-rule', handleAddRule);
  }, [activeProfileId, addMacro]);

  const startRecording = async () => {
    if (!selectedMacroId) return;
    try {
      await invoke('ipc_call', { method: 'macro.start_recording', params: { macroId: selectedMacroId } });
      setIsRecording(true);
    } catch (e) {
      triggerToast('Failed to start recording', 'error');
    }
  };

  const stopRecording = async () => {
    try {
      await invoke('ipc_call', { method: 'macro.stop_recording', params: {} });
      setIsRecording(false);
      if (activeProfileId) {
        loadMacros(activeProfileId);
      }
    } catch (e) {
      triggerToast('Failed to stop recording', 'error');
    }
  };

  const updateStep = (stepId: string, updates: Partial<MacroStep>) => {
    if (!selectedMacro) return;
    const newSteps = selectedMacro.steps.map(s => s.id === stepId ? { ...s, ...updates } : s);
    updateMacro(selectedMacro.id, { steps: newSteps });
  };

  const deleteStep = (stepId: string) => {
    if (!selectedMacro) return;
    const newSteps = selectedMacro.steps.filter(s => s.id !== stepId);
    updateMacro(selectedMacro.id, { steps: newSteps });
  };

  const addStep = (actionType: MacroActionType) => {
    if (!selectedMacro) return;
    let defaultValue: string | number = 'A';
    if (actionType === 'delay') defaultValue = 50;
    if (actionType === 'mouse_click') defaultValue = 'Left';
    if (actionType === 'mouse_move') defaultValue = '100,100';

    const newStep: MacroStep = {
      id: Math.random().toString(36).substr(2, 9),
      actionType,
      value: defaultValue
    };
    updateMacro(selectedMacro.id, { steps: [...selectedMacro.steps, newStep] });
  };

  const clearSteps = () => {
    if (!selectedMacro) return;
    updateMacro(selectedMacro.id, { steps: [] });
  };

  return (
    <div className="flex flex-col h-full space-y-4 max-w-6xl animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-lg font-bold text-app-text tracking-tight">{t('macros.title')}</h2>
          <p className="text-xs text-app-muted">
            {t('macros.description')}
          </p>
        </div>
        <button
          onClick={handleCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-app-primary hover:bg-app-primary-hover text-white rounded-lg text-xs font-semibold shadow-lg shadow-app-primary/20 transition-all duration-200 cursor-pointer"
        >
          <Plus size={14} /> {t('macros.create_macro')}
        </button>
      </div>

      <div className="flex flex-1 gap-3 min-h-0">
        {/* Left Side: Macros List */}
        <div className="w-64 bg-app-surface/60 backdrop-blur-md rounded-xl border border-app-border flex flex-col overflow-hidden">
          <div className="p-3 border-b border-app-border bg-app-bg/40 font-bold text-[10px] uppercase tracking-wider text-app-muted shrink-0">
            {t('macros.yours_macros', { count: activeMacros.length })}
          </div>
          
          <div className="overflow-y-auto flex-1 p-2 space-y-1.5">
            {activeMacros.map((macro) => {
              const isSelected = selectedMacroId === macro.id;
              return (
                <div
                  key={macro.id}
                  onClick={() => {
                    if (isRecording) stopRecording();
                    setSelectedMacroId(macro.id);
                  }}
                  className={`p-2.5 rounded-lg cursor-pointer border transition-all duration-200 ${
                    isSelected
                      ? 'border-app-primary bg-app-primary/10 glow-primary'
                      : 'border-app-border hover:border-app-border hover:bg-app-surface-hover/40 bg-app-bg/20'
                  }`}
                >
                  <div className={`font-semibold text-xs text-app-text`}>
                    {macro.name}
                  </div>
                  <div className="flex justify-between text-[10px] text-app-muted mt-1 font-medium">
                    <span>{t('macros.trigger')}: {getTriggerDescription(macro)}</span>
                    <span>{t('macros.steps_count')}: {macro.steps.length}</span>
                  </div>
                </div>
              );
            })}
            {activeMacros.length === 0 && (
              <div className="p-6 text-center text-app-muted text-xs">
                {t('macros.no_macros')}
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Step Timeline Editor */}
        <div className="flex-1 bg-app-surface/60 backdrop-blur-md rounded-xl border border-app-border flex flex-col overflow-hidden">
          {selectedMacro ? (
            <>
              {/* Timeline Header */}
              <div className="p-3.5 border-b border-app-border bg-app-bg/40 flex justify-between items-center shrink-0">
                <div className="space-y-1.5">
                  <input
                    type="text"
                    value={selectedMacro.name}
                    onChange={(e) => updateMacro(selectedMacro.id, { name: e.target.value })}
                    className="bg-transparent text-base font-bold text-app-text border-b border-transparent hover:border-app-border focus:border-app-primary focus:outline-none px-1 py-0.5 rounded transition-all max-w-[240px]"
                    placeholder={t('macros.macro_name_placeholder')}
                  />
                  <div className="flex flex-col md:flex-row gap-3 text-[11px] text-app-muted font-medium">
                    <div className="flex items-center gap-1.5">
                      {t('macros.trigger')}:
                      <button
                        onClick={() => openTriggerModal(selectedMacro)}
                        className="keycap text-[10px] py-0.5 px-2 font-mono cursor-pointer bg-app-surface-hover hover:bg-app-border text-app-accent hover:text-app-text transition-colors"
                      >
                        {getTriggerDescription(selectedMacro)}
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5">
                      🎯 {t('macros.target_process')}:
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={selectedMacro.targetApp || ''}
                          onChange={(e) => updateMacro(selectedMacro.id, { targetApp: e.target.value })}
                          className="bg-app-surface-hover border border-app-border text-[11px] text-app-text rounded-md p-1 focus:outline-none focus:ring-1 focus:ring-app-primary w-28 font-mono"
                          placeholder={t('macros.notepad_placeholder')}
                          title={t('macros.target_process_tooltip')}
                        />
                        <button
                          onClick={captureActiveWindow}
                          disabled={isCapturingWindow}
                          className={`p-1.5 rounded border text-[10px] font-semibold transition-all flex items-center gap-1 cursor-pointer ${
                            isCapturingWindow
                              ? 'bg-app-danger/20 border-app-danger/40 text-app-danger animate-pulse'
                              : 'bg-app-surface-hover hover:bg-app-border border-app-border text-app-accent'
                          }`}
                          title={t('macros.capture_title_tooltip', 'Нажмите, затем переключитесь на целевое окно в течение 3 секунд')}
                        >
                          <Target size={11} />
                          {isCapturingWindow ? t('macros.capture_countdown', { count: captureCountdown }) : t('macros.capture_btn')}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  {isRecording ? (
                    <button
                      onClick={stopRecording}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold bg-app-danger hover:bg-app-danger-hover text-white rounded-lg transition-colors animate-pulse cursor-pointer"
                      title={t('macros.global_hint')}
                    >
                      <StopCircle size={12} /> {t('macros.stop_recording')}
                    </button>
                  ) : (
                    <button
                      onClick={startRecording}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold bg-app-primary hover:bg-app-primary-hover border border-app-primary/20 text-white rounded-lg transition-colors cursor-pointer"
                      title={t('macros.global_hint')}
                    >
                      <Video size={12} /> {t('macros.start_recording')}
                    </button>
                  )}
                  <button
                    onClick={clearSteps}
                    disabled={selectedMacro.steps.length === 0}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold bg-app-surface-hover hover:bg-app-border border border-app-border text-app-muted hover:text-app-text rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {t('macros.clear_btn')}
                  </button>
                  <button
                    onClick={() => {
                      if (isRecording) stopRecording();
                      deleteMacro(selectedMacro.id);
                      setSelectedMacroId(null);
                    }}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold bg-app-danger/10 hover:bg-app-danger/20 border border-app-danger/20 text-app-danger rounded-lg transition-colors cursor-pointer"
                  >
                    <Trash2 size={12} /> {t('macros.delete_btn')}
                  </button>
                </div>
              </div>

              {/* Steps Area */}
              <div className="flex-1 overflow-y-auto p-4 bg-app-bg/20">
                {isRecording && (
                  <div className="mb-3 bg-app-danger/10 border border-app-danger/20 text-app-danger rounded-lg p-2.5 flex gap-1.5 items-center text-xs animate-pulse">
                    <AlertCircle size={12} />
                    {t('macros.recording_active_warning')}
                  </div>
                )}
                
                <div className="space-y-2 relative">
                  {selectedMacro.steps.map((step, index) => (
                    <div
                      key={step.id}
                      className={`relative flex items-center gap-4 group transition-colors duration-150 ${
                        draggedIndex === index ? 'opacity-50 border-app-primary bg-app-primary/5 scale-[1.01] shadow-lg z-20' : ''
                      }`}
                      onMouseEnter={() => handleCardMouseEnter(index)}
                    >
                      {/* Drag Handle & Timeline Counter */}
                      <div className="flex items-center gap-1.5 shrink-0 z-10">
                        {!isRecording && !capturingStepId && (
                          <div 
                            onMouseDown={() => handleHandleMouseDown(index)}
                            className={`cursor-grab text-app-muted opacity-50 hover:text-app-text transition-colors ${
                              draggedIndex === index ? 'cursor-grabbing text-app-primary opacity-100' : ''
                            }`}
                          >
                            <GripVertical size={14} className="pointer-events-none" />
                          </div>
                        )}
                        <div className="flex items-center justify-center w-8 h-8 rounded-lg border border-app-border bg-app-surface-hover text-app-muted font-mono text-[10px] font-bold shadow">
                          {index + 1}
                        </div>
                      </div>

                      {/* Timeline Card Content (Editable Step) */}
                      <div className="flex-1 p-2 rounded-lg border border-app-border bg-app-surface/80 hover:border-app-primary/20 transition-all duration-200 flex items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2 flex-1">
                          {/* Step type selector */}
                          <select
                            value={step.actionType}
                            onChange={(e) => {
                              const type = e.target.value as MacroActionType;
                              let val: string | number = 'A';
                              if (type === 'delay') val = 50;
                              if (type === 'mouse_click') val = 'Left';
                              if (type === 'mouse_move') val = '100,100';
                              updateStep(step.id, { actionType: type, value: val });
                            }}
                            className="bg-app-surface-hover border border-app-border text-xs text-app-text rounded-md p-1.5 focus:outline-none focus:ring-1 focus:ring-app-primary"
                          >
                            <option value="key_down">{t('macros.step_types.key_down')}</option>
                            <option value="key_up">{t('macros.step_types.key_up')}</option>
                            <option value="mouse_click">{t('macros.step_types.mouse_click')}</option>
                            <option value="mouse_move">{t('macros.step_types.mouse_move')}</option>
                            <option value="delay">{t('macros.step_types.delay')}</option>
                          </select>

                          {/* Dynamic value editor */}
                          {step.actionType === 'delay' ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                value={step.value}
                                onChange={(e) => updateStep(step.id, { value: parseInt(e.target.value) || 0 })}
                                className="w-20 bg-app-surface-hover border border-app-border text-xs text-app-text rounded-md p-1.5 focus:outline-none focus:ring-1 focus:ring-app-primary font-mono"
                                min="0"
                              />
                              <span className="text-xs text-app-muted">{t('macros.ms')}</span>
                            </div>
                          ) : step.actionType === 'mouse_click' ? (
                            <select
                              value={step.value}
                              onChange={(e) => updateStep(step.id, { value: e.target.value })}
                              className="bg-app-surface-hover border border-app-border text-xs text-app-text rounded-md p-1.5 focus:outline-none focus:ring-1 focus:ring-app-primary"
                            >
                              <option value="Left">{t('macros.mouse_buttons.left')}</option>
                              <option value="Right">{t('macros.mouse_buttons.right')}</option>
                              <option value="Middle">{t('macros.mouse_buttons.middle')}</option>
                              <option value="XButton1">{t('macros.mouse_buttons.xbutton1')}</option>
                              <option value="XButton2">{t('macros.mouse_buttons.xbutton2')}</option>
                            </select>
                          ) : step.actionType === 'mouse_move' ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-app-muted">X:</span>
                              <input
                                type="number"
                                value={parseInt(step.value.toString().split(',')[0]) || 0}
                                onChange={(e) => {
                                  const parts = step.value.toString().split(',');
                                  const y = parts[1] || '0';
                                  updateStep(step.id, { value: `${e.target.value},${y}` });
                                }}
                                className="w-16 bg-app-surface-hover border border-app-border text-xs text-app-text rounded-md p-1.5 focus:outline-none focus:ring-1 focus:ring-app-primary font-mono"
                              />
                              <span className="text-xs text-app-muted">Y:</span>
                              <input
                                type="number"
                                value={parseInt(step.value.toString().split(',')[1]) || 0}
                                onChange={(e) => {
                                  const parts = step.value.toString().split(',');
                                  const x = parts[0] || '0';
                                  updateStep(step.id, { value: `${x},${e.target.value}` });
                                }}
                                className="w-16 bg-app-surface-hover border border-app-border text-xs text-app-text rounded-md p-1.5 focus:outline-none focus:ring-1 focus:ring-app-primary font-mono"
                              />
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setCapturingStepId(step.id)}
                              className={`px-2.5 py-1.5 border rounded-md text-xs font-mono transition-all cursor-pointer ${
                                capturingStepId === step.id
                                  ? 'border-app-primary bg-app-primary/10 text-app-text animate-pulse'
                                  : 'border-app-border bg-app-surface-hover text-app-text hover:border-app-primary/30'
                              }`}
                            >
                              {capturingStepId === step.id ? `${t('remapping.press_key_prompt')}...` : step.value || t('macros.capture_btn')}
                            </button>
                          )}
                        </div>

                        {/* Delete Step */}
                        <button
                          onClick={() => deleteStep(step.id)}
                          className="p-1 text-app-muted hover:text-app-danger hover:bg-app-danger/10 rounded transition-all duration-200 border border-transparent hover:border-app-danger/20 cursor-pointer"
                          title="Удалить шаг"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                  
                  {selectedMacro.steps.length === 0 && (
                    <div className="text-center text-app-muted py-8">
                      <PlaySquare className="w-8 h-8 mx-auto mb-2 opacity-20 text-app-primary" />
                      {t('macros.no_steps')}
                    </div>
                  )}
                </div>
              </div>

              {/* Timeline Footer (Add step manual actions) */}
              <div className="p-2.5 border-t border-app-border bg-app-bg/40 flex flex-wrap items-center justify-between gap-2 shrink-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[9px] font-bold text-app-muted uppercase tracking-wider mr-1">{t('macros.add_label')}</span>
                  <button
                    onClick={() => addStep('key_down')}
                    className="px-2 py-1 bg-app-surface-hover hover:bg-app-border border border-app-border text-[11px] font-semibold rounded text-app-text transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <Keyboard size={10} className="text-app-primary" /> {t('macros.step_add.key_down', 'Key Down')}
                  </button>
                  <button
                    onClick={() => addStep('key_up')}
                    className="px-2 py-1 bg-app-surface-hover hover:bg-app-border border border-app-border text-[11px] font-semibold rounded text-app-text transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <Keyboard size={10} className="text-app-muted" /> {t('macros.step_add.key_up', 'Key Up')}
                  </button>
                  <button
                    onClick={() => addStep('mouse_click')}
                    className="px-2 py-1 bg-app-surface-hover hover:bg-app-border border border-app-border text-[11px] font-semibold rounded text-app-text transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <MousePointer size={10} className="text-app-accent" /> {t('macros.step_add.mouse_click', 'Mouse Click')}
                  </button>
                  <button
                    onClick={() => addStep('mouse_move')}
                    className="px-2 py-1 bg-app-surface-hover hover:bg-app-border border border-app-border text-[11px] font-semibold rounded text-app-text transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <MousePointer size={10} className="text-app-accent" /> {t('macros.step_add.mouse_move', 'Mouse Move')}
                  </button>
                  <button
                    onClick={() => addStep('delay')}
                    className="px-2 py-1 bg-app-surface-hover hover:bg-app-border border border-app-border text-[11px] font-semibold rounded text-app-text transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <Clock size={10} className="text-app-warning" /> {t('macros.step_add.delay', 'Delay')}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-app-muted p-8">
              <PlaySquare className="w-10 h-14 mb-2 opacity-10 text-app-primary" />
              <p className="font-semibold text-xs">{t('macros.select_macro_hint')}</p>
              <p className="text-[11px] text-app-muted/60 mt-1 max-w-[240px] text-center">
                {t('macros.select_macro_hint_desc')}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Trigger Settings Modal */}
      {isTriggerModalOpen && (
        <div className="fixed inset-0 bg-app-bg/80 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
          <div className="bg-app-surface border border-app-border rounded-xl shadow-2xl w-[440px] overflow-hidden flex flex-col glow-primary animate-scale-in">
            {/* Modal Header */}
            <div className="p-4 border-b border-app-border bg-app-bg/40 flex justify-between items-center">
              <h3 className="text-base font-bold text-app-text">{t('macros.trigger_modal.title')}</h3>
              <button
                onClick={() => setIsTriggerModalOpen(false)}
                className="text-app-muted hover:text-app-text transition-colors text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 space-y-4">
              {/* Key Capture Box */}
              <div>
                <label className="block text-[10px] font-bold text-app-muted uppercase tracking-wider mb-1.5">
                  {t('macros.trigger')}
                </label>
                <button
                  onClick={() => setTempCapturing(!tempCapturing)}
                  className={`w-full p-4 rounded-lg border text-center font-mono transition-all cursor-pointer select-none text-xs flex items-center justify-center gap-2 ${
                    tempCapturing
                      ? 'border-app-primary bg-app-primary/10 text-app-text animate-pulse shadow-inner'
                      : 'border-app-border bg-app-surface-hover hover:bg-app-border text-app-accent hover:text-app-text'
                  }`}
                >
                  <Keyboard size={14} className={tempCapturing ? 'text-app-primary' : 'text-app-muted'} />
                  {tempCapturing
                    ? t('macros.trigger_modal.capture_box_active')
                    : tempTriggerKey
                    ? tempTriggerKey
                    : t('macros.trigger_modal.capture_box_placeholder')}
                </button>
              </div>

              {/* Trigger Type Select */}
              <div>
                <label className="block text-[10px] font-bold text-app-muted uppercase tracking-wider mb-1.5">
                  {t('macros.trigger_modal.type_label')}
                </label>
                <select
                  value={tempTriggerType}
                  onChange={(e) => {
                    const type = e.target.value as any;
                    setTempTriggerType(type);
                    if (type === 'double_press') {
                      setTempTriggerTime(300);
                    } else if (type === 'long_press') {
                      setTempTriggerTime(450);
                    } else {
                      setTempTriggerTime(0);
                    }
                  }}
                  className="w-full bg-app-surface-hover border border-app-border text-xs text-app-text rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-app-primary"
                >
                  <option value="single">{t('macros.trigger_modal.type_single')}</option>
                  <option value="double_press">{t('macros.trigger_modal.type_double')}</option>
                  <option value="long_press">{t('macros.trigger_modal.type_long')}</option>
                </select>
              </div>

              {/* Timing Slider */}
              {tempTriggerType !== 'single' && (
                <div className="space-y-1.5 animate-fade-in">
                  <div className="flex justify-between items-center text-[10px] font-bold text-app-muted uppercase tracking-wider">
                    <span>
                      {tempTriggerType === 'double_press'
                        ? t('macros.trigger_modal.timing_label_double')
                        : t('macros.trigger_modal.timing_label_long')}
                    </span>
                    <span className="text-app-primary font-mono normal-case text-xs">
                      {tempTriggerTime} {t('macros.ms')}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={tempTriggerType === 'double_press' ? 100 : 100}
                    max={tempTriggerType === 'double_press' ? 600 : 2000}
                    step={tempTriggerType === 'double_press' ? 10 : 50}
                    value={tempTriggerTime}
                    onChange={(e) => setTempTriggerTime(Number(e.target.value))}
                    className="w-full accent-app-primary bg-app-border rounded-lg h-1 appearance-none cursor-pointer"
                  />
                </div>
              )}

              {/* Keyboard Layout Restriction */}
              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold text-app-muted uppercase tracking-wider">
                  {t('macros.trigger_modal.layout_label')}
                </label>
                <select
                  value={tempTriggerLayout}
                  onChange={(e) => setTempTriggerLayout(e.target.value as any)}
                  className="w-full bg-app-surface-hover border border-app-border text-xs text-app-text rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-app-primary"
                >
                  <option value="any">{t('macros.trigger_modal.layout_any')}</option>
                  <option value="en">{t('macros.trigger_modal.layout_en')}</option>
                  <option value="ru">{t('macros.trigger_modal.layout_ru')}</option>
                </select>
                <span className="block text-[9px] text-app-muted/60 leading-normal">
                  {t('macros.trigger_modal.layout_hint')}
                </span>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-3 border-t border-app-border bg-app-bg/40 flex justify-end gap-2 shrink-0">
              <button
                onClick={() => setIsTriggerModalOpen(false)}
                className="px-3 py-1.5 bg-app-surface-hover hover:bg-app-border border border-app-border text-xs font-semibold rounded-lg text-app-muted hover:text-app-text transition-colors cursor-pointer"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSaveTrigger}
                disabled={!tempTriggerKey}
                className="px-3 py-1.5 bg-app-primary hover:bg-app-primary-hover text-white text-xs font-semibold rounded-lg shadow-lg shadow-app-primary/20 transition-all disabled:opacity-50 cursor-pointer"
              >
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};