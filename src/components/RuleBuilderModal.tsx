import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { FrontendRule, FrontendTrigger } from '../lib/types';
import { ActionEditor } from './ruleBuilder/ActionEditor';
import { ConditionEditor } from './ruleBuilder/ConditionEditor';
import { KeyPicker } from './ruleBuilder/KeyPicker';
import { ConfirmDialog } from './ConfirmDialog';

interface RuleBuilderModalProps {
  existingRule: FrontendRule | null;
  onClose: () => void;
  onSave: (rule: FrontendRule) => void;
}

type TriggerType = FrontendTrigger['type'];

function makeInitialRule(existingRule: FrontendRule | null): FrontendRule {
  if (!existingRule) {
    return {
      id: crypto.randomUUID(),
      name: '',
      trigger: { type: 'keyDown', code: 0 },
      actions: [],
      holdActions: [],
      conditions: [],
      priority: 0,
    };
  }

  return structuredClone(existingRule);
}

export const RuleBuilderModal: React.FC<RuleBuilderModalProps> = ({ existingRule, onClose, onSave }) => {
  const { t } = useTranslation();
  const initialRule = useMemo(() => makeInitialRule(existingRule), [existingRule]);
  const [rule, setRule] = useState<FrontendRule>(initialRule);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  const isDirty = JSON.stringify(rule) !== JSON.stringify(initialRule);
  const isTapHold = rule.trigger.type === 'tapHoldKeyDown';

  const requestClose = () => {
    if (isDirty) setShowCloseConfirm(true);
    else onClose();
  };

  const handleSave = () => {
    onSave(rule);
  };

  const changeTriggerType = (type: TriggerType) => {
    if (type === 'tapHoldKeyDown') {
      setRule(current => ({ ...current, trigger: { type, code: 0, timeoutMs: 200 } }));
    } else if (type === 'typedText') {
      setRule(current => ({ ...current, trigger: { type, sequence: '' } }));
    } else {
      setRule(current => ({ ...current, trigger: { type, code: 0 } }));
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/25 flex items-center justify-center z-50">
        <div className="bg-app-bg border border-app-border shadow-2xl w-[640px] max-w-[calc(100vw-32px)] flex flex-col rounded-md overflow-hidden">
          <div className="h-11 px-4 border-b border-app-border bg-app-surface/55 flex justify-between items-center shrink-0">
            <h3 className="text-sm font-semibold text-app-text">
              {existingRule ? t('ruleBuilder.modal.edit_title') : t('ruleBuilder.modal.create_title')}
            </h3>
            <button
              type="button"
              onClick={requestClose}
              className="h-7 w-7 flex items-center justify-center rounded hover:bg-app-surface-hover text-app-muted hover:text-app-text"
              title={t('common.close', 'Закрыть')}
            >
              <X size={15} />
            </button>
          </div>

          <div className="p-4 space-y-5 max-h-[72vh] overflow-y-auto">
            <section className="space-y-1.5">
              <label className="text-[11px] font-semibold text-app-muted">{t('ruleBuilder.tabs.name', 'Название правила')}</label>
              <input
                type="text"
                value={rule.name || ''}
                onChange={event => setRule(current => ({ ...current, name: event.target.value }))}
                placeholder={t('ruleBuilder.placeholders.name', 'Название правила')}
                className="bg-app-bg border border-app-border text-xs text-app-text rounded-md h-8 px-2.5 w-full outline-none focus:border-app-primary"
              />
            </section>

            <section className="space-y-1.5">
              <label className="text-[11px] font-semibold text-app-muted">{t('ruleBuilder.tabs.trigger')}</label>
              <div className="flex gap-2 items-center">
                <select
                  value={rule.trigger.type}
                  onChange={event => changeTriggerType(event.target.value as TriggerType)}
                  className="bg-app-bg border border-app-border text-xs text-app-text rounded-md h-8 px-2"
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
                    value={rule.trigger.sequence}
                    onChange={event => setRule(current => ({
                      ...current,
                      trigger: { type: 'typedText', sequence: event.target.value },
                    }))}
                    placeholder={t('ruleBuilder.placeholders.sequence')}
                    className="bg-app-bg border border-app-border text-xs text-app-text rounded-md h-8 px-2.5 flex-grow outline-none focus:border-app-primary"
                  />
                ) : (
                  <KeyPicker
                    value={rule.trigger.code}
                    onChange={code => setRule(current => ({
                      ...current,
                      trigger: { ...current.trigger, code } as FrontendTrigger,
                    }))}
                  />
                )}

                {rule.trigger.type === 'tapHoldKeyDown' && (
                  <input
                    type="number"
                    min={1}
                    value={rule.trigger.timeoutMs}
                    onChange={event => {
                      const timeoutMs = Math.max(1, Number.parseInt(event.target.value, 10) || 200);
                      setRule(current => current.trigger.type === 'tapHoldKeyDown'
                        ? { ...current, trigger: { ...current.trigger, timeoutMs } }
                        : current);
                    }}
                    className="bg-app-bg border border-app-border text-xs text-app-text rounded-md h-8 px-2 w-24 outline-none focus:border-app-primary"
                    title={t('ruleBuilder.placeholders.timeout_title')}
                  />
                )}
              </div>
            </section>

            <section className="space-y-2">
              <div className="flex justify-between items-center">
                <h4 className="text-[11px] font-semibold text-app-muted">{t('ruleBuilder.tabs.conditions')}</h4>
                <button
                  type="button"
                  onClick={() => setRule(current => ({
                    ...current,
                    conditions: [...current.conditions, { type: 'windowMatch', process: '', title: '' }],
                  }))}
                  className="h-7 px-2 text-[11px] border border-app-border rounded-md text-app-primary hover:bg-app-surface"
                >
                  + {t('ruleBuilder.buttons.add_condition')}
                </button>
              </div>

              {rule.conditions.length === 0 ? (
                <p className="text-xs text-app-muted">{t('ruleBuilder.hints.no_conditions_global')}</p>
              ) : (
                <div className="space-y-2">
                  {rule.conditions.map((condition, index) => (
                    <ConditionEditor
                      key={index}
                      condition={condition}
                      onChange={nextCondition => {
                        setRule(current => {
                          const conditions = [...current.conditions];
                          conditions[index] = nextCondition;
                          return { ...current, conditions };
                        });
                      }}
                      onRemove={() => setRule(current => ({
                        ...current,
                        conditions: current.conditions.filter((_, itemIndex) => itemIndex !== index),
                      }))}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-2">
              <div className="flex justify-between items-center">
                <h4 className="text-[11px] font-semibold text-app-muted">
                  {isTapHold ? t('ruleBuilder.tabs.tap_actions') : t('ruleBuilder.tabs.actions')}
                </h4>
                <button
                  type="button"
                  onClick={() => setRule(current => ({
                    ...current,
                    actions: [...current.actions, { type: 'typeText', text: '' }],
                  }))}
                  className="h-7 px-2 text-[11px] border border-app-border rounded-md text-app-primary hover:bg-app-surface"
                >
                  + {t('ruleBuilder.buttons.add_action')}
                </button>
              </div>

              {rule.actions.length === 0 ? (
                <p className="text-xs text-app-danger">{t('ruleBuilder.hints.must_have_action')}</p>
              ) : (
                <div className="space-y-2">
                  {rule.actions.map((action, index) => (
                    <ActionEditor
                      key={index}
                      action={action}
                      onChange={nextAction => {
                        setRule(current => {
                          const actions = [...current.actions];
                          actions[index] = nextAction;
                          return { ...current, actions };
                        });
                      }}
                      onRemove={() => setRule(current => ({
                        ...current,
                        actions: current.actions.filter((_, itemIndex) => itemIndex !== index),
                      }))}
                    />
                  ))}
                </div>
              )}
            </section>

            {isTapHold && (
              <section className="space-y-2 border border-app-border rounded-md p-3 bg-app-surface/25">
                <div className="flex justify-between items-center">
                  <h4 className="text-[11px] font-semibold text-app-muted">{t('ruleBuilder.tabs.hold_actions')}</h4>
                  <button
                    type="button"
                    onClick={() => setRule(current => ({
                      ...current,
                      holdActions: [...(current.holdActions || []), { type: 'holdLayer', layerId: '' }],
                    }))}
                    className="h-7 px-2 text-[11px] border border-app-border rounded-md text-app-primary hover:bg-app-bg"
                  >
                    + {t('ruleBuilder.buttons.add_hold_action')}
                  </button>
                </div>

                {!rule.holdActions || rule.holdActions.length === 0 ? (
                  <p className="text-xs text-app-muted">{t('ruleBuilder.hints.no_hold_actions')}</p>
                ) : (
                  <div className="space-y-2">
                    {rule.holdActions.map((action, index) => (
                      <ActionEditor
                        key={index}
                        action={action}
                        onChange={nextAction => setRule(current => {
                          const holdActions = [...(current.holdActions || [])];
                          holdActions[index] = nextAction;
                          return { ...current, holdActions };
                        })}
                        onRemove={() => setRule(current => ({
                          ...current,
                          holdActions: (current.holdActions || []).filter((_, itemIndex) => itemIndex !== index),
                        }))}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>

          <div className="h-12 px-4 border-t border-app-border bg-app-surface/40 flex justify-end items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={requestClose}
              className="h-8 px-3 text-xs border border-app-border rounded-md text-app-text hover:bg-app-surface-hover"
            >
              {t('ruleBuilder.buttons.cancel')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={rule.actions.length === 0}
              className="h-8 px-4 bg-app-primary hover:bg-app-primary-hover disabled:opacity-45 text-white rounded-md text-xs font-semibold"
            >
              {t('ruleBuilder.buttons.save_rule')}
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={showCloseConfirm}
        title={t('ruleBuilder.unsaved_title', 'Несохранённые изменения')}
        message={t('ruleBuilder.unsaved_message', 'Закрыть редактор и отбросить изменения?')}
        confirmLabel={t('ruleBuilder.discard_changes', 'Отбросить')}
        danger
        onCancel={() => setShowCloseConfirm(false)}
        onConfirm={() => {
          setShowCloseConfirm(false);
          onClose();
        }}
      />
    </>
  );
};
