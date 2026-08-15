import { useEffect, useState } from 'react';

interface TextPromptDialogProps {
  open: boolean;
  title: string;
  label?: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel: string;
  cancelLabel: string;
  onCancel: () => void;
  onConfirm: (value: string) => void | Promise<void>;
}

export function TextPromptDialog({
  open,
  title,
  label,
  initialValue = '',
  placeholder,
  confirmLabel,
  cancelLabel,
  onCancel,
  onConfirm,
}: TextPromptDialogProps) {
  const [value, setValue] = useState(initialValue);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setValue(initialValue);
      setSubmitting(false);
    }
  }, [open, initialValue]);

  if (!open) return null;

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await onConfirm(trimmed);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/35 p-4" onMouseDown={onCancel}>
      <div
        className="w-[420px] max-w-full border border-app-border bg-app-bg shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="h-10 px-3 flex items-center border-b border-app-border bg-app-surface/60 text-xs font-semibold text-app-text">
          {title}
        </div>
        <div className="p-3">
          {label && <label className="mb-1.5 block text-[11px] text-app-muted">{label}</label>}
          <input
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit();
              if (event.key === 'Escape') onCancel();
            }}
            placeholder={placeholder}
            className="h-8 w-full border border-app-border bg-app-bg px-2 text-xs text-app-text outline-none focus:border-app-primary"
          />
        </div>
        <div className="h-11 px-3 flex items-center justify-end gap-2 border-t border-app-border bg-app-surface/35">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="h-7 px-3 border border-app-border bg-app-bg text-[11px] text-app-text hover:bg-app-surface-hover disabled:opacity-40"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!value.trim() || submitting}
            className="h-7 px-4 border border-app-primary bg-app-primary text-[11px] font-semibold text-white hover:bg-app-primary-hover disabled:opacity-40"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
