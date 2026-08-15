import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Внутреннее окно подтверждения вместо native window.confirm().
 * Важные операции блокируют повторное подтверждение до завершения callback.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setBusy(false);
      return;
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }
    };

    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const handleConfirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[10010] flex items-center justify-center bg-black/35 p-4"
      onMouseDown={(event) => {
        if (!busy && event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="w-[430px] max-w-full border border-app-border bg-app-bg shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="h-10 px-3 flex items-center gap-2 border-b border-app-border bg-app-surface/60">
          {danger && <AlertTriangle size={13} className="shrink-0 text-app-danger" />}
          <h3 id="confirm-dialog-title" className="min-w-0 truncate text-xs font-semibold text-app-text">{title}</h3>
        </div>

        <div className="min-h-20 px-3 py-3 flex items-start">
          <p className="text-[11px] leading-5 text-app-muted whitespace-pre-line select-text">{message}</p>
        </div>

        <div className="h-11 px-3 flex items-center justify-end gap-2 border-t border-app-border bg-app-surface/35">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-7 px-3 border border-app-border bg-app-bg text-[11px] text-app-text hover:bg-app-surface-hover disabled:opacity-40"
          >
            {cancelLabel || t('confirmDialog.cancel', { defaultValue: 'Отмена' })}
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={busy}
            className={`h-7 px-4 border text-[11px] font-semibold text-white disabled:opacity-45 ${
              danger
                ? 'border-app-danger bg-app-danger hover:bg-red-600'
                : 'border-app-primary bg-app-primary hover:bg-app-primary-hover'
            }`}
          >
            {busy
              ? t('common.saving', { defaultValue: 'Выполняется…' })
              : confirmLabel || t('confirmDialog.confirm', { defaultValue: 'Подтвердить' })}
          </button>
        </div>
      </div>
    </div>
  );
};
