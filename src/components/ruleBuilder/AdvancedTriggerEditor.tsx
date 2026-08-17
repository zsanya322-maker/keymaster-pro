import { useTranslation } from 'react-i18next';
import type { FrontendTrigger, GestureDirection } from '../../lib/types';
import { vkToName } from '../../lib/keyCodes';
import { KeyPicker } from './KeyPicker';

type AdvancedTrigger = Extract<
  FrontendTrigger,
  { type: 'leaderSequence' | 'keySequence' | 'keyChordSet' | 'mouseGesture' }
>;

interface Props {
  trigger: FrontendTrigger;
  disabled?: boolean;
  onChange: (trigger: FrontendTrigger) => void;
}

const inputClass = 'h-7 border border-app-border bg-app-bg px-2 text-[10px] text-app-text outline-none focus:border-app-primary disabled:opacity-50';
const chipClass = 'h-6 px-1.5 inline-flex items-center gap-1 border border-app-border bg-app-surface/35 text-[9px] text-app-text';

function isAdvanced(trigger: FrontendTrigger): trigger is AdvancedTrigger {
  return trigger.type === 'leaderSequence'
    || trigger.type === 'keySequence'
    || trigger.type === 'keyChordSet'
    || trigger.type === 'mouseGesture';
}

function KeyList({ codes, onRemove, disabled }: { codes: number[]; onRemove: (index: number) => void; disabled?: boolean }) {
  if (codes.length === 0) return <span className="text-[9px] text-app-muted">—</span>;
  return (
    <div className="flex flex-wrap items-center gap-1 min-w-0">
      {codes.map((code, index) => (
        <span key={`${code}-${index}`} className={chipClass}>
          {vkToName(code)}
          <button
            type="button"
            disabled={disabled}
            onClick={() => onRemove(index)}
            className="text-app-muted hover:text-app-danger disabled:opacity-40"
            title="Удалить"
          >×</button>
        </span>
      ))}
    </div>
  );
}

function DirectionList({ directions, onRemove, disabled }: { directions: GestureDirection[]; onRemove: (index: number) => void; disabled?: boolean }) {
  const arrows: Record<GestureDirection, string> = { up: '↑', down: '↓', left: '←', right: '→' };
  if (directions.length === 0) return <span className="text-[9px] text-app-muted">—</span>;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {directions.map((direction, index) => (
        <span key={`${direction}-${index}`} className={chipClass}>
          {arrows[direction]}
          <button type="button" disabled={disabled} onClick={() => onRemove(index)} className="text-app-muted hover:text-app-danger disabled:opacity-40">×</button>
        </span>
      ))}
    </div>
  );
}

export function AdvancedTriggerEditor({ trigger, disabled = false, onChange }: Props) {
  const { t } = useTranslation();
  if (!isAdvanced(trigger)) return null;

  if (trigger.type === 'leaderSequence') {
    const append = (code: number) => {
      if (!code || trigger.sequence.length >= 16) return;
      onChange({ ...trigger, sequence: [...trigger.sequence, code] });
    };
    return (
      <div className="flex-1 min-w-0 flex items-center gap-1.5">
        <div className="w-[185px] shrink-0">
          <KeyPicker
            value={trigger.leader}
            onChange={(leader) => onChange({ ...trigger, leader })}
            className="w-full"
          />
        </div>
        <div className="flex-1 min-w-[160px] flex items-center gap-1">
          <KeyList
            codes={trigger.sequence}
            disabled={disabled}
            onRemove={(index) => onChange({ ...trigger, sequence: trigger.sequence.filter((_, i) => i !== index) })}
          />
          {trigger.sequence.length < 16 && (
            <div className="w-[105px] shrink-0">
              <KeyPicker value={0} allowModifiers={false} onChange={append} className="w-full" />
            </div>
          )}
        </div>
        <label className="w-[86px] shrink-0 flex items-center gap-1 text-[9px] text-app-muted">
          <span>{t('advancedInput.timeout', { defaultValue: 'ms' })}</span>
          <input
            type="number"
            min={100}
            max={10000}
            value={trigger.timeoutMs}
            disabled={disabled}
            onChange={(event) => onChange({ ...trigger, timeoutMs: Math.min(10000, Math.max(100, Number.parseInt(event.target.value, 10) || 800)) })}
            className={`${inputClass} w-14 font-mono`}
          />
        </label>
      </div>
    );
  }

  if (trigger.type === 'keySequence') {
    const append = (code: number) => {
      if (!code || trigger.sequence.length >= 16) return;
      onChange({ ...trigger, sequence: [...trigger.sequence, code] });
    };
    return (
      <div className="flex-1 min-w-0 flex items-center gap-1.5">
        <KeyList
          codes={trigger.sequence}
          disabled={disabled}
          onRemove={(index) => onChange({ ...trigger, sequence: trigger.sequence.filter((_, i) => i !== index) })}
        />
        {trigger.sequence.length < 16 && (
          <div className="w-[120px] shrink-0">
            <KeyPicker value={0} allowModifiers={false} onChange={append} className="w-full" />
          </div>
        )}
        <label className="ml-auto w-[86px] shrink-0 flex items-center gap-1 text-[9px] text-app-muted">
          <span>ms</span>
          <input
            type="number"
            min={100}
            max={10000}
            value={trigger.timeoutMs}
            disabled={disabled}
            onChange={(event) => onChange({ ...trigger, timeoutMs: Math.min(10000, Math.max(100, Number.parseInt(event.target.value, 10) || 800)) })}
            className={`${inputClass} w-14 font-mono`}
          />
        </label>
      </div>
    );
  }

  if (trigger.type === 'keyChordSet') {
    const append = (code: number) => {
      if (!code || trigger.codes.length >= 8 || trigger.codes.includes(code)) return;
      onChange({ ...trigger, codes: [...trigger.codes, code] });
    };
    return (
      <div className="flex-1 min-w-0 flex items-center gap-1.5">
        <KeyList
          codes={trigger.codes}
          disabled={disabled}
          onRemove={(index) => onChange({ ...trigger, codes: trigger.codes.filter((_, i) => i !== index) })}
        />
        {trigger.codes.length < 8 && (
          <div className="w-[120px] shrink-0">
            <KeyPicker value={0} allowModifiers={false} onChange={append} className="w-full" />
          </div>
        )}
        <label className="ml-auto w-[105px] shrink-0 flex items-center gap-1 text-[9px] text-app-muted">
          <span>{t('advancedInput.skew', { defaultValue: 'skew' })}</span>
          <input
            type="number"
            min={10}
            max={1000}
            value={trigger.maxSkewMs}
            disabled={disabled}
            onChange={(event) => onChange({ ...trigger, maxSkewMs: Math.min(1000, Math.max(10, Number.parseInt(event.target.value, 10) || 80)) })}
            className={`${inputClass} w-14 font-mono`}
          />
        </label>
      </div>
    );
  }

  const appendDirection = (direction: GestureDirection) => {
    if (trigger.directions.length >= 8) return;
    onChange({ ...trigger, directions: [...trigger.directions, direction] });
  };
  return (
    <div className="flex-1 min-w-0 flex items-center gap-1.5">
      <select
        value={trigger.code}
        disabled={disabled}
        onChange={(event) => onChange({ ...trigger, code: Number.parseInt(event.target.value, 10) || 4 })}
        className={`${inputClass} w-[112px] shrink-0`}
      >
        <option value={1}>{t('ruleBuilder.action_options.mouse_left')}</option>
        <option value={2}>{t('ruleBuilder.action_options.mouse_right')}</option>
        <option value={3}>{t('ruleBuilder.action_options.mouse_middle')}</option>
        <option value={4}>{t('ruleBuilder.action_options.mouse_x1')}</option>
        <option value={5}>{t('ruleBuilder.action_options.mouse_x2')}</option>
      </select>
      <DirectionList
        directions={trigger.directions}
        disabled={disabled}
        onRemove={(index) => onChange({ ...trigger, directions: trigger.directions.filter((_, i) => i !== index) })}
      />
      {trigger.directions.length < 8 && (
        <div className="flex items-center gap-0.5 shrink-0">
          {(['up', 'down', 'left', 'right'] as GestureDirection[]).map((direction) => (
            <button
              key={direction}
              type="button"
              disabled={disabled}
              onClick={() => appendDirection(direction)}
              className="h-7 w-7 border border-app-border bg-app-bg text-[12px] text-app-text hover:bg-app-surface disabled:opacity-40"
            >
              {{ up: '↑', down: '↓', left: '←', right: '→' }[direction]}
            </button>
          ))}
        </div>
      )}
      <label className="ml-auto w-[112px] shrink-0 flex items-center gap-1 text-[9px] text-app-muted">
        <span>{t('advancedInput.distance', { defaultValue: 'px' })}</span>
        <input
          type="number"
          min={4}
          max={500}
          value={trigger.minDistance}
          disabled={disabled}
          onChange={(event) => onChange({ ...trigger, minDistance: Math.min(500, Math.max(4, Number.parseInt(event.target.value, 10) || 28)) })}
          className={`${inputClass} w-16 font-mono`}
        />
      </label>
    </div>
  );
}
