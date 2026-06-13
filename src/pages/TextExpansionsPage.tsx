import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useProfileStore } from '../store/profileStore';
import { useTextExpansionStore, TextExpansion } from '../store/textExpansionStore';

export const TextExpansionsPage: React.FC = () => {
  const { t } = useTranslation();
  const activeProfileId = useProfileStore((state) => state.activeProfileId);
  const { expansions, addExpansion, deleteExpansion, updateExpansion, loadExpansions } = useTextExpansionStore();

  const activeExpansions = expansions.filter((te) => te.profileId === activeProfileId);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingExpansion, setEditingExpansion] = useState<TextExpansion | null>(null);
  const [newRule, setNewRule] = useState({ trigger: '', replacement: '', enabled: true });

  useEffect(() => {
    if (activeProfileId) {
      loadExpansions(activeProfileId);
    }
  }, [activeProfileId, loadExpansions]);

  // Listen to toolbar Add Rule event
  useEffect(() => {
    const handleAddRule = () => {
      setEditingExpansion(null);
      setNewRule({ trigger: '', replacement: '', enabled: true });
      setIsModalOpen(true);
    };
    window.addEventListener('keymaster-add-rule', handleAddRule);
    return () => window.removeEventListener('keymaster-add-rule', handleAddRule);
  }, []);

  // Listen to menu Clear Mappings event
  useEffect(() => {
    const handleClearMappings = () => {
      activeExpansions.forEach((exp) => {
        deleteExpansion(exp.id);
      });
    };
    window.addEventListener('keymaster-clear-mappings', handleClearMappings);
    return () => window.removeEventListener('keymaster-clear-mappings', handleClearMappings);
  }, [activeExpansions, deleteExpansion]);


  const handleSave = async () => {
    if (!activeProfileId) return;

    if (editingExpansion) {
      await updateExpansion(editingExpansion.id, {
        trigger: newRule.trigger,
        replacement: newRule.replacement,
        enabled: newRule.enabled,
      });
      setEditingExpansion(null);
    } else {
      await addExpansion({
        id: Date.now().toString(),
        profileId: activeProfileId,
        trigger: newRule.trigger,
        replacement: newRule.replacement,
        enabled: newRule.enabled,
      });
    }

    setIsModalOpen(false);
    setNewRule({ trigger: '', replacement: '', enabled: true });
  };

  const handleEdit = (te: TextExpansion) => {
    setEditingExpansion(te);
    setNewRule({ trigger: te.trigger, replacement: te.replacement, enabled: te.enabled });
    setIsModalOpen(true);
  };

  const handleToggle = async (te: TextExpansion) => {
    await updateExpansion(te.id, { enabled: !te.enabled });
  };

  const insertTemplate = (template: string) => {
    setNewRule(prev => ({
      ...prev,
      replacement: prev.replacement + template
    }));
  };

  return (
    <div className="space-y-6 max-w-6xl animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-app-text tracking-tight">{t('text_expansions.title')}</h2>
          <p className="text-xs text-app-muted mt-1">
            {t('text_expansions.description')}
          </p>
        </div>
        <button
          onClick={() => {
            setEditingExpansion(null);
            setNewRule({ trigger: '', replacement: '', enabled: true });
            setIsModalOpen(true);
          }}
          className="px-4 py-2 bg-app-primary hover:bg-app-primary-hover text-white rounded-xl text-sm font-semibold shadow-lg shadow-app-primary/20 transition-all duration-200 cursor-pointer"
        >
          {t('text_expansions.add_expansion')}
        </button>
      </div>

      {/* High-Density Expansions Table */}
      <div className="overflow-x-auto border border-app-border rounded-xl bg-app-surface/20 animate-fade-in">
        <table className="w-full text-left border-collapse" style={{ fontSize: 'var(--table-font-size)' }}>
          <thead>
            <tr className="bg-app-surface/60 border-b border-app-border text-[10px] font-bold text-app-muted uppercase tracking-wider">
              <th className="px-4 py-2.5">{t('text_expansions.trigger_header', 'Trigger Keyword')}</th>
              <th className="px-4 py-2.5">{t('text_expansions.replacement_header', 'Replacement Text')}</th>
              <th className="px-4 py-2.5">{t('text_expansions.status_header', 'Status')}</th>
              <th className="px-4 py-2.5 text-right pr-6">{t('remapping.actions_header', 'Controls')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-app-border/40">
            {activeExpansions.map((te) => (
              <tr
                key={te.id}
                className={`hover:bg-app-surface-hover/30 transition-colors ${te.enabled ? '' : 'opacity-65'}`}
              >
                <td className="px-4 font-medium" style={{ paddingTop: 'var(--table-row-padding)', paddingBottom: 'var(--table-row-padding)' }}>
                  <span className="font-mono text-xs font-bold text-app-primary bg-app-primary/10 border border-app-primary/20 px-2.5 py-0.5 rounded">
                    {te.trigger}
                  </span>
                </td>
                <td className="px-4 max-w-sm truncate" style={{ paddingTop: 'var(--table-row-padding)', paddingBottom: 'var(--table-row-padding)' }}>
                  <span className="text-app-text font-medium text-[11px] font-mono leading-none">
                    {te.replacement}
                  </span>
                </td>
                <td className="px-4" style={{ paddingTop: 'var(--table-row-padding)', paddingBottom: 'var(--table-row-padding)' }}>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={te.enabled}
                      onChange={() => handleToggle(te)}
                      className="sr-only peer"
                    />
                    <div className="w-8 h-4 bg-app-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-app-muted after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-app-success peer-checked:after:bg-white" />
                  </label>
                </td>
                <td className="px-4 text-right pr-6" style={{ paddingTop: 'var(--table-row-padding)', paddingBottom: 'var(--table-row-padding)' }}>
                  <div className="flex justify-end gap-1.5">
                    <button
                      onClick={() => handleEdit(te)}
                      className="p-1 text-app-muted hover:text-app-primary hover:bg-app-primary/10 rounded border border-transparent hover:border-app-primary/20 text-xs cursor-pointer"
                      title={t('common.edit')}
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => deleteExpansion(te.id)}
                      className="p-1 text-app-muted hover:text-app-danger hover:bg-app-danger/10 rounded border border-transparent hover:border-app-danger/20 text-xs cursor-pointer"
                      title={t('common.delete')}
                    >
                      🗑️
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {activeExpansions.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-app-muted text-xs">
                  <span className="text-2xl block mb-2 opacity-30">📝</span>
                  {t('text_expansions.no_expansions')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Editor Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-app-bg/80 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
          <div className="bg-app-surface border border-app-border rounded-2xl shadow-2xl w-[480px] overflow-hidden flex flex-col glow-primary">
            <div className="p-6 border-b border-app-border bg-app-bg/40 flex justify-between items-center">
              <h3 className="text-lg font-bold text-app-text">
                {editingExpansion ? t('text_expansions.edit_title') : t('text_expansions.new_title')}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-app-muted hover:text-app-text transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-app-muted uppercase tracking-wider mb-2">{t('text_expansions.trigger_label')}</label>
                <input
                  type="text"
                  placeholder={t('text_expansions.trigger_placeholder')}
                  value={newRule.trigger}
                  onChange={(e) => setNewRule({ ...newRule, trigger: e.target.value })}
                  className="w-full bg-app-surface-hover border border-app-border text-sm text-app-text rounded-lg p-2.5 focus:outline-none focus:ring-1 focus:ring-app-primary"
                />
                <p className="text-[10px] text-app-muted mt-1">{t('text_expansions.trigger_desc')}</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-app-muted uppercase tracking-wider mb-2">{t('text_expansions.replacement_label')}</label>
                <textarea
                  rows={4}
                  placeholder={t('text_expansions.replacement_placeholder')}
                  value={newRule.replacement}
                  onChange={(e) => setNewRule({ ...newRule, replacement: e.target.value })}
                  className="w-full bg-app-surface-hover border border-app-border text-sm text-app-text rounded-lg p-2.5 focus:outline-none focus:ring-1 focus:ring-app-primary"
                />
              </div>

              {/* Templates */}
              <div>
                <span className="block text-[10px] text-app-muted font-bold uppercase tracking-wider mb-1.5">{t('text_expansions.insert_template')}</span>
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: '%date%', label: t('text_expansions.templates.date') },
                    { value: '%time%', label: t('text_expansions.templates.time') },
                    { value: '%clipboard%', label: t('text_expansions.templates.clipboard') },
                    { value: '%selected_text%', label: t('text_expansions.templates.selected_text') }
                  ].map(tpl => (
                    <button
                      key={tpl.value}
                      type="button"
                      onClick={() => insertTemplate(tpl.value)}
                      className="text-[10px] bg-app-border hover:bg-app-primary/20 hover:text-app-text text-app-muted px-2.5 py-1.5 rounded border border-app-border font-semibold transition-colors cursor-pointer"
                    >
                      {tpl.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center space-x-2.5 pt-2">
                <input
                  type="checkbox"
                  id="enabled_checkbox"
                  checked={newRule.enabled}
                  onChange={(e) => setNewRule({ ...newRule, enabled: e.target.checked })}
                  className="h-4 w-4 rounded text-app-primary focus:ring-app-primary bg-app-surface-hover border-app-border"
                />
                <label htmlFor="enabled_checkbox" className="text-sm font-semibold text-app-text cursor-pointer select-none">
                  {t('text_expansions.activate_checkbox')}
                </label>
              </div>
            </div>

            <div className="p-4 border-t border-app-border bg-app-bg/40 flex justify-end gap-2">
              <button
                onClick={() => {
                  setIsModalOpen(false);
                  setEditingExpansion(null);
                }}
                className="px-4 py-2 bg-app-surface-hover hover:bg-app-border border border-app-border text-sm font-semibold rounded-lg text-app-muted hover:text-app-text transition-colors cursor-pointer"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSave}
                disabled={!newRule.trigger.trim() || !newRule.replacement.trim()}
                className="px-4 py-2 bg-app-primary hover:bg-app-primary-hover text-white text-sm font-semibold rounded-lg shadow-lg shadow-app-primary/20 transition-all disabled:opacity-50 cursor-pointer"
              >
                {editingExpansion ? t('common.save') : t('common.add')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
