import React, { useState, useEffect, useRef } from 'react';
import { vkToName } from '../../lib/keyCodes';

interface KeyPickerProps {
  value: number;
  onChange: (vk: number) => void;
  className?: string;
}

export const KeyPicker: React.FC<KeyPickerProps> = ({ value, onChange, className = '' }) => {
  const [isRecording, setIsRecording] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isRecording) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onChange(e.keyCode);
      setIsRecording(false);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isRecording, onChange]);

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={() => setIsRecording(prev => !prev)}
      className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all duration-200 cursor-pointer min-w-[120px] text-center select-none ${
        isRecording
          ? 'bg-app-primary/20 border-app-primary text-app-primary animate-pulse'
          : 'bg-app-bg border-app-border text-app-text hover:bg-app-surface-hover hover:border-app-muted'
      } ${className}`}
      title={isRecording ? 'Listening for keypress...' : 'Click to capture key'}
    >
      {isRecording ? 'Press key...' : `${vkToName(value)} (${value})`}
    </button>
  );
};
