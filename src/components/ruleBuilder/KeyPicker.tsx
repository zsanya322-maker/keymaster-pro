import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { vkToName } from '../../lib/keyCodes';

interface KeyPickerProps {
  value: number;
  onChange: (vk: number) => void;
  className?: string;
}

const LISTEN_TIMEOUT_MS = 10_000;

export const KeyPicker: React.FC<KeyPickerProps> = ({ value, onChange, className = '' }) => {
  const { t } = useTranslation();
  const [isRecording, setIsRecording] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const lastFinishTime = useRef(0);

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!isRecording) return;

    invoke('ipc_call', { method: 'keycapture.set_active', params: { active: true } })
      .catch((error) => console.warn('keycapture.set_active failed', error));

    return () => {
      invoke('ipc_call', { method: 'keycapture.set_active', params: { active: false } })
        .catch((error) => console.warn('keycapture.set_active (off) failed', error));
    };
  }, [isRecording]);

  useEffect(() => {
    if (!isRecording) return;

    const timeoutId = window.setTimeout(() => setIsRecording(false), LISTEN_TIMEOUT_MS);
    const finishedRef = { current: false };

    const finish = (vk: number) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      onChangeRef.current(vk);
      lastFinishTime.current = Date.now();
      setIsRecording(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      finish(event.keyCode === 27 ? 0 : event.keyCode);
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button === 3 || event.button === 4) return;
      event.preventDefault();
      event.stopPropagation();

      if (buttonRef.current?.contains(event.target as Node)) {
        setIsRecording(false);
        return;
      }

      const mouseButtonToCode: Record<number, number> = {
        0: 1,
        2: 2,
        1: 3,
      };
      const code = mouseButtonToCode[event.button];
      if (code !== undefined) finish(code);
    };

    let pollActive = true;
    const pollMouseCapture = async () => {
      while (pollActive && !finishedRef.current) {
        try {
          const result = await invoke<{ button: number }>('ipc_call', {
            method: 'keycapture.get_captured_mouse',
          });
          if (result.button >= 1 && result.button <= 5) {
            finish(result.button);
            return;
          }
        } catch (error) {
          console.warn('keycapture.get_captured_mouse failed', error);
        }
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
    };

    void pollMouseCapture();
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('mousedown', handleMouseDown, true);

    return () => {
      pollActive = false;
      window.clearTimeout(timeoutId);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('mousedown', handleMouseDown, true);
    };
  }, [isRecording]);

  const keyName = value === 0 ? t('keyPicker.none') : vkToName(value);

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={() => {
        if (Date.now() - lastFinishTime.current < 100) return;
        setIsRecording((current) => !current);
      }}
      className={`h-7 min-w-[100px] px-2 border text-[11px] text-left select-none transition-colors ${
        isRecording
          ? 'border-app-primary bg-app-primary/8 text-app-primary'
          : 'border-app-border bg-app-bg text-app-text hover:bg-app-surface'
      } ${className}`}
      title={isRecording
        ? t('keyPicker.listening_tooltip')
        : value === 0
          ? t('keyPicker.capture_tooltip')
          : `${t('keyPicker.capture_tooltip')} · VK ${value}`}
    >
      {isRecording ? t('keyPicker.press_key') : keyName}
    </button>
  );
};
