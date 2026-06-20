import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FrontendRule, FrontendTrigger } from '../lib/types';
import { ActionEditor } from './ruleBuilder/ActionEditor';
import { ConditionEditor } from './ruleBuilder/ConditionEditor';
import { KeyPicker } from './ruleBuilder/KeyPicker';

interface RuleBuilderModalProps {
  existingRule: FrontendRule | null;
  onClose: () => void;
  onSave: (rule: FrontendRule) => void;
}

export const RuleBuilderModal: React.FC<RuleBuilderModalProps> = ({ existingRule, onClose, onSave }) => {
  const { t } = useTranslation();
  const [rule, setRule] = useState<FrontendRule>(existingRule ? {
    // deep copy to avoid mutations before save
    ...existingRule,
    name: existingRule.name || '',
    actions: [...existingRule.actions],
    conditions: [...existingRule.conditions],
    holdActions: existingRule.holdActions ? [...existingRule.holdActions] : [],
    trigger: { ...existingRule.trigger }
  } : {
    id: crypto.randomUUID(),
    name: '',
    trigger: { type: 'keyDown', code: 0 },
    actions: [],
    holdActions: [],
    conditions: [],
    priority: 0,
  });

  const handleSave = () => {
    onSave(rule);
  };

  const isTapHold = rule.trigger.type === 'tapHoldKeyDown';

  return (
    <div className="fixed inset-0 bg-app-bg/80 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
      <div className="bg-app-surface border border-app-border rounded-xl shadow-2xl w-[600px] flex flex-col glow-primary">
        <div className="p-4 border-b border-app-border bg-app-bg/40 flex justify-between items-center">
          <h3 className="text-base font-bold text-app-text">
            {existingRule ? t('ruleBuilder.modal.edit_title') : t('ruleBuilder.modal.create_title')}
          </h3>
          <button onClick={onClose} className="text-app-muted hover:text-app-text transition-colors">
            ✕
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          {/* RULE NAME */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-app-muted uppercase tracking-wider">{t('ruleBuilder.tabs.name', 'Название правила')}</h4>
            <input
              type="text"
              value={rule.name || ''}
              onChange={(e) => setRule({ ...rule, name: e.target.value })}
              placeholder={t('ruleBuilder.placeholders.name', 'Назовите правило (например, "Копировать")')}
              className="bg-app-surface-hover border border-app-border text-sm text-app-text rounded-lg p-2 w-full focus:ring-1 focus:ring-app-primary"
            />
          </div>

          {/* TRIGGER */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-app-muted uppercase tracking-wider">{t('ruleBuilder.tabs.trigger')}</h4>
            <div className="flex gap-2">
              <select 
                value={rule.trigger.type}
                onChange={(e) => {
                  const type = e.target.value as any;
                  if (type === 'tapHoldKeyDown') {
                    setRule({ ...rule, trigger: { type, code: 0, timeoutMs: 200 } });
                  } else if (type === 'typedText') {
                    setRule({ ...rule, trigger: { type, sequence: '' } });
                  } else {
                    setRule({ ...rule, trigger: { type, code: 0 } });
                  }
                }}
                className="bg-app-surface-hover border border-app-border text-sm text-app-text rounded-lg p-2"
              >
                <option value="keyDown">{t('ruleBuilder.trigger_types.keyDown')}</option>
                <option value="keyUp">{t('ruleBuilder.trigger_types.keyUp')}</option>
                <option value="mouseDown">{t('ruleBuilder.trigger_types.mouseDown')}</option>
                <option value="mouseUp">{t('ruleBuilder.trigger_types.mouseUp')}</option>
                <option value="tapHoldKeyDown">{t('ruleBuilder.trigger_types.tapHoldKeyDown')}</option>
                <option value="typedText">{t('ruleBuilder.trigger_types.typedText')}</option>
              </select>
              
              {rule.trigger.type === 'typedText' ? (
                <input
                  type="text"
                  value={rule.trigger.sequence || ''}
                  onChange={(e) => setRule({
                    ...rule,
                    trigger: { type: 'typedText', sequence: e.target.value }
                  })}
                  placeholder={t('ruleBuilder.placeholders.sequence')}
                  className="bg-app-surface-hover border border-app-border text-sm text-app-text rounded-lg p-2 flex-grow"
                />
              ) : (
                <KeyPicker
                  value={(rule.trigger as any).code || 0}
                  onChange={(vk) => setRule({
                    ...rule,
                    trigger: { ...rule.trigger, code: vk } as FrontendTrigger
                  })}
                />
              )}
              
              {isTapHold && (
                <input 
                  type="number"
                  value={(rule.trigger as any).timeoutMs || 200}
                  onChange={(e) => {
                    if (rule.trigger.type === 'tapHoldKeyDown') {
                      setRule({
                        ...rule,
                        trigger: {
                          ...rule.trigger,
                          timeoutMs: parseInt(e.target.value) || 200
                        }
                      });
                    }
                  }}
                  placeholder={t('ruleBuilder.placeholders.timeout')}
                  className="bg-app-surface-hover border border-app-border text-sm text-app-text rounded-lg p-2 w-32"
                  title={t('ruleBuilder.placeholders.timeout_title')}
                />
              )}
            </div>
          </div>

          {/* CONDITIONS */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-app-muted uppercase tracking-wider flex justify-between items-center">
              {t('ruleBuilder.tabs.conditions')}
              <button 
                onClick={() => setRule({ ...rule, conditions: [...rule.conditions, { type: 'processActive', process: '' }] })}
                className="text-[10px] bg-app-primary/20 text-app-primary px-2 py-1 rounded hover:bg-app-primary/40 transition-colors"
              >
                {t('ruleBuilder.buttons.add_condition')}
              </button>
            </h4>
            {rule.conditions.length === 0 ? (
              <p className="text-xs text-app-muted opacity-60 italic">{t('ruleBuilder.hints.no_conditions_global')}</p>
            ) : (
              <div className="space-y-2">
                {rule.conditions.map((cond, i) => (
                  <ConditionEditor 
                    key={i} 
                    condition={cond} 
                    onChange={(newCond) => {
                      const newConds = [...rule.conditions];
                      newConds[i] = newCond;
                      setRule({ ...rule, conditions: newConds });
                    }}
                    onRemove={() => {
                      setRule({ ...rule, conditions: rule.conditions.filter((_, idx) => idx !== i) });
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* ACTIONS (TAP ACTIONS if TapHold) */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-app-muted uppercase tracking-wider flex justify-between items-center">
              {isTapHold ? t('ruleBuilder.tabs.tap_actions') : t('ruleBuilder.tabs.actions')}
              <button 
                onClick={() => setRule({ ...rule, actions: [...rule.actions, { type: 'typeText', text: '' }] })}
                className="text-[10px] bg-app-primary/20 text-app-primary px-2 py-1 rounded hover:bg-app-primary/40 transition-colors"
              >
                {t('ruleBuilder.buttons.add_action')}
              </button>
            </h4>
            {rule.actions.length === 0 ? (
              <p className="text-xs text-app-danger italic">{t('ruleBuilder.hints.must_have_action')}</p>
            ) : (
              <div className="space-y-2">
                {rule.actions.map((act, i) => (
                  <ActionEditor 
                    key={i}
                    action={act}
                    onChange={(newAct) => {
                      const newActs = [...rule.actions];
                      newActs[i] = newAct;
                      setRule({ ...rule, actions: newActs });
                    }}
                    onRemove={() => {
                      setRule({ ...rule, actions: rule.actions.filter((_, idx) => idx !== i) });
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* HOLD ACTIONS */}
          {isTapHold && (
            <div className="space-y-2 p-3 bg-app-bg/50 border border-app-border rounded-lg mt-4">
              <h4 className="text-xs font-bold text-app-muted uppercase tracking-wider flex justify-between items-center">
                {t('ruleBuilder.tabs.hold_actions')}
                <button 
                  onClick={() => setRule({ ...rule, holdActions: [...(rule.holdActions || []), { type: 'holdLayer', layerId: '' }] })}
                  className="text-[10px] bg-app-primary/20 text-app-primary px-2 py-1 rounded hover:bg-app-primary/40 transition-colors"
                >
                  {t('ruleBuilder.buttons.add_hold_action')}
                </button>
              </h4>
              {!rule.holdActions || rule.holdActions.length === 0 ? (
                <p className="text-xs text-app-muted opacity-60 italic">{t('ruleBuilder.hints.no_hold_actions')}</p>
              ) : (
                <div className="space-y-2">
                  {rule.holdActions.map((act, i) => (
                    <ActionEditor 
                      key={i}
                      action={act}
                      onChange={(newAct) => {
                        const newActs = [...rule.holdActions!];
                        newActs[i] = newAct;
                        setRule({ ...rule, holdActions: newActs });
                      }}
                      onRemove={() => {
                        setRule({ ...rule, holdActions: rule.holdActions!.filter((_, idx) => idx !== i) });
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

        </div>

        <div className="p-4 border-t border-app-border bg-app-bg/40 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-app-muted hover:text-app-text transition-colors">
            {t('ruleBuilder.buttons.cancel')}
          </button>
          <button 
            onClick={handleSave} 
            disabled={rule.actions.length === 0}
            className="px-4 py-2 bg-app-primary hover:bg-app-primary-hover disabled:opacity-50 text-white rounded-lg text-sm font-semibold shadow-lg shadow-app-primary/20 transition-all cursor-pointer"
          >
            {t('ruleBuilder.buttons.save_rule')}
          </button>
        </div>
      </div>
    </div>
  );
};
