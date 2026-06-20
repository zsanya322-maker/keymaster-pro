import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProfileStore } from '../store/profileStore';
import { useAppStore } from '../stores/app-store';
import { RuleBuilderModal } from '../components/RuleBuilderModal';
import { FrontendRule } from '../lib/types';

export const RulesPage: React.FC = () => {
  const { t } = useTranslation();
  const { profiles, activeProfileId, saveProfile } = useProfileStore();
  const daemonConnected = useAppStore(state => state.daemonConnected);
  const activeProfile = profiles.find(p => p.id === activeProfileId) || null;
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<FrontendRule | null>(null);

  const handleAddRule = () => {
    setEditingRule(null);
    setIsModalOpen(true);
  };

  const handleEditRule = (rule: FrontendRule) => {
    setEditingRule(rule);
    setIsModalOpen(true);
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (!activeProfile) return;
    const newProfile = { ...activeProfile, rules: activeProfile.rules.filter(r => r.id !== ruleId) };
    await saveProfile(newProfile);
  };

  const handleSaveRule = async (rule: FrontendRule) => {
    if (!activeProfile) return;
    const newRules = editingRule
      ? activeProfile.rules.map(r => r.id === rule.id ? rule : r)
      : [...activeProfile.rules, rule];
    await saveProfile({ ...activeProfile, rules: newRules });
    setIsModalOpen(false);
  };

  if (!activeProfile) {
    if (!daemonConnected) {
      return (
        <div className="p-8 text-center text-app-muted flex flex-col items-center gap-3">
          <div className="text-2xl opacity-50">🔌</div>
          <div className="font-semibold">{t('rules.daemon_off_title')}</div>
          <div className="text-xs max-w-md">
            {t('rules.daemon_off_hint')}
            <code className="block mt-2 text-[10px] bg-app-surface px-2 py-1 rounded">%APPDATA%\KeyMaster Pro\logs\daemon.log</code>
          </div>
        </div>
      );
    }
    if (profiles.length > 0) {
      return <div className="p-8 text-center text-app-muted">{t('rules.no_profile_select')}</div>;
    }
    return (
      <div className="p-8 text-center text-app-muted flex flex-col items-center gap-2">
        <div className="animate-pulse">{t('rules.loading_profiles')}</div>
      </div>
    );
  }

  return (
    <div className="space-y-4 h-full flex flex-col animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-app-text tracking-tight">{t('rules.title')}</h2>
          <p className="text-xs text-app-muted">
            {t('rules.description')}
          </p>
        </div>
        <button
          onClick={handleAddRule}
          className="px-4 py-2 bg-app-primary hover:bg-app-primary-hover text-white rounded-lg text-sm font-semibold shadow-lg shadow-app-primary/20 transition-all duration-200 cursor-pointer"
        >
          ➕ {t('rules.add_rule')}
        </button>
      </div>

      {/* Rules Table */}
      <div className="flex-1 overflow-y-auto border border-app-border rounded-xl bg-app-surface/40 backdrop-blur-md">
        <table className="w-full text-left border-collapse" style={{ fontSize: 'var(--table-font-size, 12px)' }}>
          <thead>
            <tr className="bg-app-surface border-b border-app-border text-[11px] font-bold text-app-muted uppercase tracking-wider">
              <th className="px-4 py-3">{t('rules.col_name', 'Название')}</th>
              <th className="px-4 py-3">{t('rules.col_trigger')}</th>
              <th className="px-4 py-3">{t('rules.col_conditions')}</th>
              <th className="px-4 py-3">{t('rules.col_actions')}</th>
              <th className="px-4 py-3 text-right">{t('rules.col_controls')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-app-border/40">
            {activeProfile.rules.map((rule) => {
              const triggerText = `${rule.trigger.type} (${(rule.trigger as any).code})`;
              
              return (
                <tr key={rule.id} className="hover:bg-app-surface-hover/30 transition-colors">
                  <td className="px-4 py-3 font-semibold text-app-text">
                    {rule.name || <span className="opacity-40 italic text-xs">{t('rules.no_name', 'Без названия')}</span>}
                  </td>
                  <td className="px-4 py-3 font-medium">
                    <span className="keycap font-mono text-xs">{triggerText}</span>
                  </td>
                  <td className="px-4 py-3 text-app-muted">
                    {rule.conditions.length === 0 ? <span className="opacity-50">—</span> : (
                      <div className="flex flex-wrap gap-1">
                        {rule.conditions.map((c, i) => (
                          <span key={i} className="px-1.5 py-0.5 rounded bg-app-primary/10 border border-app-primary/20 text-app-primary text-[10px]">
                            {c.type}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      {rule.actions.map((a, i) => (
                        <span key={`tap-${i}`} className="px-2 py-1 rounded bg-app-surface border border-app-border text-app-text text-xs font-mono inline-block w-fit">
                          {rule.trigger.type === 'tapHoldKeyDown' ? t('rules.tap_prefix') : ''}{a.type}
                        </span>
                      ))}
                      {rule.holdActions?.map((a, i) => (
                        <span key={`hold-${i}`} className="px-2 py-1 rounded bg-app-primary/10 border border-app-primary/30 text-app-primary text-xs font-mono inline-block w-fit mt-1">
                          {t('rules.hold_prefix')}{a.type}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => handleEditRule(rule)}
                        className="p-1.5 text-app-muted hover:text-app-primary hover:bg-app-primary/10 rounded cursor-pointer transition-colors"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => handleDeleteRule(rule.id)}
                        className="p-1.5 text-app-muted hover:text-app-danger hover:bg-app-danger/10 rounded cursor-pointer transition-colors"
                      >
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {activeProfile.rules.length === 0 && (
              <tr>
                <td colSpan={5} className="py-12 text-center text-app-muted">
                  <span className="text-3xl block mb-2 opacity-30">⚡</span>
                  {t('rules.empty_state')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <RuleBuilderModal 
          existingRule={editingRule} 
          onClose={() => setIsModalOpen(false)} 
          onSave={handleSaveRule} 
        />
      )}
    </div>
  );
};
