import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { KeyChord } from '../../lib/types';
import {
  ALL_KEYS,
  MOD_ALT,
  MOD_CTRL,
  MOD_LALT,
  MOD_LCTRL,
  MOD_LSHIFT,
  MOD_LWIN,
  MOD_RALT,
  MOD_RCTRL,
  MOD_RSHIFT,
  MOD_RWIN,
  MOD_SHIFT,
  MOD_WIN,
  formatKeyChord,
  genericizeModifierMask,
} from '../../lib/keyCodes';

interface ChordKeyPickerProps {
  value: KeyChord;
  onChange: (chord: KeyChord) => void;
  className?: string;
  allowModifiers?: boolean;
}

interface SingleKeyPickerProps {
  value: number;
  onChange: (code: number) => void;
  className?: string;
  allowModifiers?: false;
}

type KeyPickerProps = ChordKeyPickerProps | SingleKeyPickerProps;

const LISTEN_TIMEOUT_MS = 10_000;
const MODIFIERS = [
  ['Ctrl', MOD_CTRL],
  ['Alt', MOD_ALT],
  ['Shift', MOD_SHIFT],
  ['Win', MOD_WIN],
] as const;
const SIDE_MODIFIERS = [
  ['LCtrl', MOD_LCTRL], ['RCtrl', MOD_RCTRL],
  ['LAlt', MOD_LALT], ['RAlt', MOD_RALT],
  ['LShift', MOD_LSHIFT], ['RShift', MOD_RSHIFT],
  ['LWin', MOD_LWIN], ['RWin', MOD_RWIN],
] as const;

export function KeyPicker(props: ChordKeyPickerProps): React.ReactElement;
export function KeyPicker(props: SingleKeyPickerProps): React.ReactElement;
export function KeyPicker(props: KeyPickerProps): React.ReactElement {
  const { t } = useTranslation();
  const [isRecording, setIsRecording] = useState(false);
  const [preserveSides, setPreserveSides] = useState(false);
  const lastFinishTime = useRef(0);
  const propsRef = useRef<KeyPickerProps>(props);
  const numericMode = typeof props.value === 'number';
  const value: KeyChord = numericMode
    ? { code: props.value as number, modifiers: 0 }
    : props.value as KeyChord;
  const allowModifiers = numericMode ? false : (props.allowModifiers ?? true);
  const className = props.className ?? '';

  useEffect(() => {
    propsRef.current = props;
  }, [props]);

  const emit = (next: KeyChord) => {
    const current = propsRef.current;
    if (typeof current.value === 'number') {
      (current.onChange as (code: number) => void)(next.code);
    } else {
      (current.onChange as (chord: KeyChord) => void)(next);
    }
  };

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

    let active = true;
    const timeoutId = window.setTimeout(() => setIsRecording(false), LISTEN_TIMEOUT_MS);

    const finish = (captured: KeyChord) => {
      if (!active) return;
      const next: KeyChord = {
        code: captured.code,
        modifiers: allowModifiers
          ? preserveSides
            ? captured.modifiers
            : genericizeModifierMask(captured.modifiers)
          : 0,
      };
      emit(next);
      lastFinishTime.current = Date.now();
      setIsRecording(false);
    };

    const poll = async () => {
      while (active) {
        try {
          const captured = await invoke<KeyChord>('ipc_call', {
            method: 'keycapture.get_captured_key',
          });
          if (captured.code !== 0 || captured.modifiers !== 0) {
            finish(captured);
            return;
          }
        } catch (error) {
          console.warn('keycapture.get_captured_key failed', error);
        }
        await new Promise((resolve) => setTimeout(resolve, 55));
      }
    };

    void poll();
    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [allowModifiers, isRecording, preserveSides]);

  const toggleModifier = (bit: number) => {
    if (!allowModifiers) return;
    emit({ ...value, modifiers: value.modifiers ^ bit });
  };

  return (
    <div className={`relative flex items-center min-w-0 ${className}`}>
      <button
        type="button"
        onClick={() => {
          if (Date.now() - lastFinishTime.current < 100) return;
          setIsRecording((current) => !current);
        }}
        className={`h-7 flex-1 min-w-[110px] px-2 border text-[11px] text-left select-none transition-colors ${
          isRecording
            ? 'border-app-primary bg-app-primary/8 text-app-primary'
            : 'border-app-border bg-app-bg text-app-text hover:bg-app-surface'
        }`}
        title={isRecording
          ? t('keyPicker.listening_tooltip')
          : `${t('keyPicker.capture_tooltip')} · VK ${value.code}`}
      >
        {isRecording ? t('keyPicker.press_key') : formatKeyChord(value)}
      </button>

      <details className="relative shrink-0">
        <summary
          className="list-none h-7 w-7 ml-1 inline-flex items-center justify-center border border-app-border bg-app-bg text-app-muted hover:bg-app-surface hover:text-app-text cursor-pointer"
          title={t('common.advanced', { defaultValue: 'Дополнительно' })}
        >
          <MoreHorizontal size={13} />
        </summary>
        <div className="absolute z-30 right-0 top-8 w-[310px] border border-app-border bg-app-bg shadow-lg p-2 text-[10px] text-app-text">
          <div className="flex items-center gap-1.5">
            <select
              value={value.code}
              onChange={(event) => emit({ ...value, code: Number.parseInt(event.target.value, 10) || 0 })}
              className="h-7 flex-1 min-w-0 border border-app-border bg-app-bg px-2 text-[10px] outline-none focus:border-app-primary"
            >
              <option value={0}>{t('keyPicker.none')}</option>
              {ALL_KEYS.map((key) => <option key={key.vk} value={key.vk}>{key.name}</option>)}
            </select>
            <button
              type="button"
              onClick={() => emit({ code: 0, modifiers: 0 })}
              className="h-7 px-2 border border-app-border bg-app-bg text-app-muted hover:bg-app-surface"
            >
              {t('common.reset', { defaultValue: 'Сброс' })}
            </button>
          </div>

          {allowModifiers && (
            <>
              <div className="mt-2 text-[9px] text-app-muted">
                {t('keyPicker.modifiers', { defaultValue: 'Модификаторы' })}
              </div>
              <div className="mt-1 grid grid-cols-4 gap-1">
                {MODIFIERS.map(([name, bit]) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => toggleModifier(bit)}
                    className={`h-6 border text-[9px] ${value.modifiers & bit ? 'border-app-primary bg-app-primary/10 text-app-primary' : 'border-app-border bg-app-bg text-app-text hover:bg-app-surface'}`}
                  >
                    {name}
                  </button>
                ))}
              </div>

              <label className="mt-2 h-6 flex items-center gap-1.5 text-[9px] text-app-muted select-none">
                <input
                  type="checkbox"
                  checked={preserveSides}
                  onChange={(event) => {
                    setPreserveSides(event.target.checked);
                    if (!event.target.checked) {
                      emit({ ...value, modifiers: genericizeModifierMask(value.modifiers) });
                    }
                  }}
                />
                {t('keyPicker.exact_sides', { defaultValue: 'Различать левый/правый модификатор' })}
              </label>

              {preserveSides && (
                <div className="mt-1 grid grid-cols-4 gap-1 border-t border-app-border/60 pt-1.5">
                  {SIDE_MODIFIERS.map(([name, bit]) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => toggleModifier(bit)}
                      className={`h-6 border text-[9px] ${value.modifiers & bit ? 'border-app-primary bg-app-primary/10 text-app-primary' : 'border-app-border bg-app-bg text-app-text hover:bg-app-surface'}`}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </details>
    </div>
  );
}
