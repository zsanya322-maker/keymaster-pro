import React, { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { vkToName } from '../../lib/keyCodes';

interface KeyPickerProps {
  value: number;
  onChange: (vk: number) => void;
  className?: string;
}

/** Авто-выход из режима listening, если юзер забыл нажать клавишу. */
const LISTEN_TIMEOUT_MS = 10_000;

export const KeyPicker: React.FC<KeyPickerProps> = ({ value, onChange, className = '' }) => {
  const { t } = useTranslation();
  const [isRecording, setIsRecording] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const lastFinishTime = useRef(0);

  // Управление флагом key_capture_active в daemon.
  // Когда isRecording=true — включаем (правила временно отключаются, клавиши/клики
  // проходят до приложения в первозданном виде, что позволяет записать даже
  // кнопку, заблокированную активным правилом).
  // Снимаем флаг при любом выходе из listening, а также при unmount компонента.
  useEffect(() => {
    if (!isRecording) return;

    let cancelled = false;
    invoke('ipc_call', { method: 'keycapture.set_active', params: { active: true } })
      .catch((e) => console.warn('keycapture.set_active failed', e));

    return () => {
      if (cancelled) return;
      invoke('ipc_call', { method: 'keycapture.set_active', params: { active: false } })
        .catch((e) => console.warn('keycapture.set_active (off) failed', e));
    };
  }, [isRecording]);

  useEffect(() => {
    if (!isRecording) return;

    // Авто-таймаут: если за LISTEN_TIMEOUT_MS не нажата клавиша — выходим из listening.
    const timeoutId = window.setTimeout(() => {
      setIsRecording(false);
    }, LISTEN_TIMEOUT_MS);

    const finish = (vk: number) => {
      onChange(vk);
      setIsRecording(false);
      lastFinishTime.current = Date.now();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.keyCode === 27) { // Escape
        finish(0);
        return;
      }
      finish(e.keyCode);
    };

    // Мышиные кнопки: браузер отдаёт button 0/1/2, маппим в VK_LBUTTON/VK_RBUTTON/VK_MBUTTON.
    // Благодаря key_capture_active=true клик всегда доходит до WebView, даже если
    // активное правило блокирует эту кнопку мыши.
    const handleMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // Если клик пришелся по самой кнопке записи, просто выключаем запись (отмена)
      if (buttonRef.current && buttonRef.current.contains(e.target as Node)) {
        setIsRecording(false);
        return;
      }
      const vkMap = [0x01, 0x02, 0x04]; // VK_LBUTTON, VK_RBUTTON, VK_MBUTTON
      const vk = vkMap[e.button] ?? 0x01;
      finish(vk);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('mousedown', handleMouseDown, true);
    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('mousedown', handleMouseDown, true);
    };
  }, [isRecording, onChange]);

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={() => {
        if (Date.now() - lastFinishTime.current < 100) return;
        setIsRecording(prev => !prev);
      }}
      className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all duration-200 cursor-pointer min-w-[120px] text-center select-none ${
        isRecording
          ? 'bg-app-primary/20 border-app-primary text-app-primary animate-pulse'
          : 'bg-app-bg border-app-border text-app-text hover:bg-app-surface-hover hover:border-app-muted'
      } ${className}`}
      title={isRecording ? t('keyPicker.listening_tooltip') : t('keyPicker.capture_tooltip')}
    >
      {isRecording
        ? t('keyPicker.press_key')
        : value === 0
          ? t('keyPicker.none', 'None')
          : `${vkToName(value)} (${value})`}
    </button>
  );
};
