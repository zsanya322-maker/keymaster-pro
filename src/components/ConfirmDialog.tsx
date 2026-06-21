import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Универсальное модальное окно подтверждения.
 *
 * Заменяет native window.confirm(), который в Tauri WebView может не показываться
 * или показываться как системное окно браузера. Это окно рендерится внутри React
 * и гарантированно отображается.
 *
 * Закрытие по Escape или клику по фону вызывает onCancel.
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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="bg-app-surface border border-app-border rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
        <div className="px-5 py-4 border-b border-app-border">
          <h3 className="text-base font-bold text-app-text">{title}</h3>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-app-muted whitespace-pre-line">{message}</p>
        </div>
        <div className="px-5 py-3 bg-app-bg/40 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-1.5 rounded-lg text-sm font-medium border border-app-border text-app-text hover:bg-app-surface-hover transition-colors cursor-pointer"
          >
            {cancelLabel || t('confirmDialog.cancel', 'Отмена')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold text-white transition-colors cursor-pointer ${
              danger
                ? 'bg-app-danger hover:bg-red-600'
                : 'bg-app-primary hover:bg-app-primary-hover'
            }`}
          >
            {confirmLabel || t('confirmDialog.confirm', 'Подтвердить')}
          </button>
        </div>
      </div>
    </div>
  );
};
