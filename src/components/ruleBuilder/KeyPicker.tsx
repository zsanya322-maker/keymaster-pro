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

  // Ref на onChange, чтобы он не попадал в deps useEffect для поллинга.
  // Иначе каждое изменение value в родителе пересоздаёт колбэк, перезапускает
  // поллинг и плодит десятки параллельных invoke — IPC не успевает, приложение виснет.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

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

    // Флаг защиты от двойной записи: клавиша/кнопка может прийти одновременно
    // из handleKeyDown (клавиши), handleMouseDown (L/R/M) и поллинга daemon (X1/X2).
    // Первое же срабатывание завершает запись, остальные игнорируются.
    const finishedRef = { current: false };

    const finish = (vk: number) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      onChangeRef.current(vk);
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

      // Мышиные кнопки: JS MouseEvent.button отдаёт 0=L, 1=M, 2=R, 3=X1, 4=X2.
      // Маппим в единые коды с hooks.rs/engine (1=L, 2=R, 3=M, 4=X1, 5=X2).
      // Благодаря key_capture_active=true клик всегда доходит до WebView, даже если
      // активное правило блокирует эту кнопку мыши.
      // ВАЖНО: WebView2 (Edge) НЕ передаёт X1/X2 в JS как mousedown — он перехватывает
      // их как «Назад/Вперёд». Поэтому X1/X2 дополнительно ловятся поллингом ниже.
      const handleMouseDown = (e: MouseEvent) => {
        // Игнорируем X1/X2 в JS — они не доходят стабильно, ловим только поллингом.
        if (e.button === 3 || e.button === 4) return;
        e.preventDefault();
        e.stopPropagation();
        // Если клик пришелся по самой кнопке записи, просто выключаем запись (отмена)
        if (buttonRef.current && buttonRef.current.contains(e.target as Node)) {
          setIsRecording(false);
          return;
        }
        // e.button: 0=L, 1=M, 2=R → единые коды 1=L, 2=R, 3=M
        const MOUSE_BUTTON_TO_VK: Record<number, number> = {
          0: 1, // LMB
          2: 2, // RMB
          1: 3, // MMB
        };
        const vk = MOUSE_BUTTON_TO_VK[e.button];
        if (vk === undefined) return;
        finish(vk);
      };

    // Поллинг захвата мыши из daemon. Покрывает ВСЕ 5 кнопок (L/R/M/X1/X2),
    // но критически важен для X1/X2, которые WebView2 не передаёт в JS.
    // Хук при key_capture_active=true сохраняет код кнопки 1-5 в last_captured_mouse,
    // мы забираем его здесь и завершаем запись.
    // Интервал 80мс — IPC roundtrip и так ~60мс, чаще нет смысла, а риск
    // перегрузить IPC-сервер и повесить приложение есть.
    let pollActive = true;
    const pollMouseCapture = async () => {
      while (pollActive && !finishedRef.current) {
        try {
          const res = await invoke<{ button: number }>('ipc_call', {
            method: 'keycapture.get_captured_mouse',
          });
          if (res.button && res.button >= 1 && res.button <= 5) {
            finish(res.button);
            return;
          }
        } catch (e) {
          console.warn('keycapture.get_captured_mouse failed', e);
        }
        await new Promise((r) => setTimeout(r, 80));
      }
    };
    pollMouseCapture();

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('mousedown', handleMouseDown, true);
    return () => {
      pollActive = false;
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
