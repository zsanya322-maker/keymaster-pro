import React, { useMemo, useState, type ReactNode } from 'react';
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

function EditorSection({ title, action, children }: { title: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="border border-app-border bg-app-bg">
      <div className="h-8 px-2.5 flex items-center border-b border-app-border bg-app-surface/55">
        <h4 className="text-[11px] font-semibold text-app-text">{title}</h4>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div className="p-2.5">{children}</div>
    </section>
  );
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

  const changeTriggerType = (type: TriggerType) => {
    if (type === 'tapHoldKeyDown') {
      setRule((current) => ({ ...current, trigger: { type, code: 0, timeoutMs: 200 } }));
    } else if (type === 'typedText') {
      setRule((current) => ({ ...current, trigger: { type, sequence: '' } }));
    } else {
      setRule((current) => ({ ...current, trigger: { type, code: 0 } }));
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
        <div className="w-[780px] max-w-full max-h-[86vh] flex flex-col overflow-hidden border border-app-border bg-app-bg shadow-2xl">
          <div className="h-10 px-3 flex items-center border-b border-app-border bg-app-surface/60 shrink-0">
            <h3 className="text-xs font-semibold text-app-text">
              {existingRule ? t('ruleBuilder.modal.edit_title') : t('ruleBuilder.modal.create_title')}
            </h3>
            <button
              type="button"
              onClick={requestClose}
              className="ml-auto h-7 w-7 inline-flex items-center justify-center text-app-muted hover:bg-app-surface-hover hover:text-app-text"
              title={t('common.close', 'Закрыть')}
            >
              <X size={14} />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
            <EditorSection title={t('ruleBuilder.tabs.name', 'Основные свойства')}>
              <div className="grid grid-cols-[130px_minmax(0,1fr)] border border-app-border/70">
                <label className="min-h-9 px-2.5 flex items-center border-b border-r border-app-border/70 bg-app-surface/35 text-[11px] text-app-muted">
                  {t('ruleBuilder.tabs.name', 'Название правила')}
                </label>
                <div className="min-h-9 p-1.5 border-b border-app-border/70">
                  <input
                    type="text"
                    value={rule.name || ''}
                    onChange={(event) => setRule((current) => ({ ...current, name: event.target.value }))}
                    placeholder={t('ruleBuilder.placeholders.name', 'Название правила')}
                    className="h-7 w-full border border-app-border bg-app-bg px-2 text-[11px] text-app-text outline-none focus:border-app-primary"
                  />
                </div>

                <label className="min-h-9 px-2.5 flex items-center border-r border-app-border/70 bg-app-surface/35 text-[11px] text-app-muted">
                  {t('ruleBuilder.priority', 'Приоритет')}
                </label>
                <div className="min-h-9 p-1.5 flex items-center gap-2">
                  <input
                    type="number"
                    value={rule.priority}
                    onChange={(event) => setRule((current) => ({
                      ...current,
                      priority: Number.parseInt(event.target.value, 10) || 0,
                    }))}
                    className="h-7 w-24 border border-app-border bg-app-bg px-2 text-[11px] font-mono text-app-text outline-none focus:border-app-primary"
                  />
                  <span className="text-[10px] text-app-muted">
                    {t('ruleBuilder.priority_hint', 'Большее значение выполняется раньше')}
                  </span>
                </div>
              </div>
            </EditorSection>

            <EditorSection title={t('ruleBuilder.tabs.trigger')}>
              <div className="grid grid-cols-[180px_minmax(0,1fr)] gap-2">
                <select
                  value={rule.trigger.type}
                  onChange={(event) => changeTriggerType(event.target.value as TriggerType)}
                  className="h-8 border border-app-border bg-app-surface/45 px-2 text-[11px] text-app-text outline-none focus:border-app-primary"
                >
                  <option value="keyDown">{t('ruleBuilder.trigger_types.keyDown')}</option>
                  <option value="keyUp">{t('ruleBuilder.trigger_types.keyUp')}</option>
                  <option value="mouseDown">{t('ruleBuilder.trigger_types.mouseDown')}</option>
                  <option value="mouseUp">{t('ruleBuilder.trigger_types.mouseUp')}</option>
                  <option value="tapHoldKeyDown">{t('ruleBuilder.trigger_types.tapHoldKeyDown')}</option>
                  <option value="typedText">{t('ruleBuilder.trigger_types.typedText')}</option>
                </select>

                <div className="flex min-w-0 gap-2">
                  {rule.trigger.type === 'typedText' ? (
                    <input
                      type="text"
                      value={rule.trigger.sequence}
                      onChange={(event) => setRule((current) => ({
                        ...current,
                        trigger: { type: 'typedText', sequence: event.target.value },
                      }))}
                      placeholder={t('ruleBuilder.placeholders.sequence')}
                      className="h-8 flex-1 min-w-0 border border-app-border bg-app-bg px-2 text-[11px] text-app-text outline-none focus:border-app-primary"
                    />
                  ) : (
                    <KeyPicker
                      value={rule.trigger.code}
                      onChange={(code) => setRule((current) => ({
                        ...current,
                        trigger: { ...current.trigger, code } as FrontendTrigger,
                      }))}
                      className="flex-1 min-w-0 text-left"
                    />
                  )}

                  {rule.trigger.type === 'tapHoldKeyDown' && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <input
                        type="number"
                        min={1}
                        value={rule.trigger.timeoutMs}
                        onChange={(event) => {
                          const timeoutMs = Math.max(1, Number.parseInt(event.target.value, 10) || 200);
                          setRule((current) => current.trigger.type === 'tapHoldKeyDown'
                            ? { ...current, trigger: { ...current.trigger, timeoutMs } }
                            : current);
                        }}
                        className="h-8 w-20 border border-app-border bg-app-bg px-2 text-[11px] font-mono text-app-text outline-none focus:border-app-primary"
                        title={t('ruleBuilder.placeholders.timeout_title')}
                      />
                      <span className="text-[10px] text-app-muted">ms</span>
                    </div>
                  )}
                </div>
              </div>
            </EditorSection>

            <EditorSection
              title={t('ruleBuilder.tabs.conditions')}
              action={(
                <button
                  type="button"
                  onClick={() => setRule((current) => ({
                    ...current,
                    conditions: [...current.conditions, { type: 'windowMatch', process: '', title: '' }],
                  }))}
                  className="h-6 px-2 border border-app-border bg-app-bg text-[10px] text-app-primary hover:bg-app-surface"
                >
                  + {t('ruleBuilder.buttons.add_condition')}
                </button>
              )}
            >
              {rule.conditions.length === 0 ? (
                <div className="py-2 text-[11px] text-app-muted">{t('ruleBuilder.hints.no_conditions_global')}</div>
              ) : (
                <div className="space-y-1.5">
                  {rule.conditions.map((condition, index) => (
                    <ConditionEditor
                      key={index}
                      condition={condition}
                      onChange={(nextCondition) => setRule((current) => {
                        const conditions = [...current.conditions];
                        conditions[index] = nextCondition;
                        return { ...current, conditions };
                      })}
                      onRemove={() => setRule((current) => ({
                        ...current,
                        conditions: current.conditions.filter((_, itemIndex) => itemIndex !== index),
                      }))}
                    />
                  ))}
                </div>
              )}
            </EditorSection>

            <EditorSection
              title={isTapHold ? t('ruleBuilder.tabs.tap_actions') : t('ruleBuilder.tabs.actions')}
              action={(
                <button
                  type="button"
                  onClick={() => setRule((current) => ({
                    ...current,
                    actions: [...current.actions, { type: 'typeText', text: '' }],
                  }))}
                  className="h-6 px-2 border border-app-border bg-app-bg text-[10px] text-app-primary hover:bg-app-surface"
                >
                  + {t('ruleBuilder.buttons.add_action')}
                </button>
              )}
            >
              {rule.actions.length === 0 ? (
                <div className="py-2 text-[11px] text-app-danger">{t('ruleBuilder.hints.must_have_action')}</div>
              ) : (
                <div className="space-y-1.5">
                  {rule.actions.map((action, index) => (
                    <ActionEditor
                      key={index}
                      action={action}
                      onChange={(nextAction) => setRule((current) => {
                        const actions = [...current.actions];
                        actions[index] = nextAction;
                        return { ...current, actions };
                      })}
                      onRemove={() => setRule((current) => ({
                        ...current,
                        actions: current.actions.filter((_, itemIndex) => itemIndex !== index),
                      }))}
                    />
                  ))}
                </div>
              )}
            </EditorSection>

            {isTapHold && (
              <EditorSection
                title={t('ruleBuilder.tabs.hold_actions')}
                action={(
                  <button
                    type="button"
                    onClick={() => setRule((current) => ({
                      ...current,
                      holdActions: [...(current.holdActions || []), { type: 'holdLayer', layerId: '' }],
                    }))}
                    className="h-6 px-2 border border-app-border bg-app-bg text-[10px] text-app-primary hover:bg-app-surface"
                  >
                    + {t('ruleBuilder.buttons.add_hold_action')}
                  </button>
                )}
              >
                {!rule.holdActions || rule.holdActions.length === 0 ? (
                  <div className="py-2 text-[11px] text-app-muted">{t('ruleBuilder.hints.no_hold_actions')}</div>
                ) : (
                  <div className="space-y-1.5">
                    {rule.holdActions.map((action, index) => (
                      <ActionEditor
                        key={index}
                        action={action}
                        onChange={(nextAction) => setRule((current) => {
                          const holdActions = [...(current.holdActions || [])];
                          holdActions[index] = nextAction;
                          return { ...current, holdActions };
                        })}
                        onRemove={() => setRule((current) => ({
                          ...current,
                          holdActions: (current.holdActions || []).filter((_, itemIndex) => itemIndex !== index),
                        }))}
                      />
                    ))}
                  </div>
                )}
              </EditorSection>
            )}
          </div>

          <div className="h-11 px-3 flex items-center justify-end gap-2 border-t border-app-border bg-app-surface/45 shrink-0">
            <button
              type="button"
              onClick={requestClose}
              className="h-7 px-3 border border-app-border bg-app-bg text-[11px] text-app-text hover:bg-app-surface-hover"
            >
              {t('ruleBuilder.buttons.cancel')}
            </button>
            <button
              type="button"
              onClick={() => onSave(rule)}
              disabled={rule.actions.length === 0}
              className="h-7 px-4 border border-app-primary bg-app-primary text-[11px] font-semibold text-white hover:bg-app-primary-hover disabled:opacity-45"
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
