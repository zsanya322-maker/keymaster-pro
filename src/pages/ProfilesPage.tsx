import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useProfileStore, Profile } from '../store/profileStore';
import { User, Plus, AppWindow } from 'lucide-react';

export const ProfilesPage: React.FC = () => {
  const { t } = useTranslation();
  const { profiles, activeProfileId, addProfile, updateProfile, setActiveProfile, deleteProfile, loadProfiles } = useProfileStore();
  
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  return (
    <div className="space-y-6 max-w-6xl animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-app-text tracking-tight">{t('profiles.title')}</h2>
          <p className="text-xs text-app-muted mt-1">
            {t('profiles.description')}
          </p>
        </div>
        <button
          onClick={() => addProfile({ id: Date.now().toString(), name: t('profiles.new_profile_default'), isDefault: false, linkedApps: [] })}
          className="flex items-center gap-2 px-4 py-2 bg-app-primary hover:bg-app-primary-hover text-white rounded-xl text-sm font-semibold shadow-lg shadow-app-primary/20 transition-all duration-200 cursor-pointer"
        >
          <Plus size={16} /> {t('profiles.create_profile')}
        </button>
      </div>

      {/* Profiles grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {profiles.map(profile => {
          const isActive = activeProfileId === profile.id;
          return (
            <div
              key={profile.id}
              className={`p-6 rounded-2xl border bg-app-surface/60 backdrop-blur-md flex flex-col justify-between min-h-[220px] transition-all duration-300 relative overflow-hidden group ${
                isActive ? 'border-app-primary glow-primary' : 'border-app-border hover:border-app-primary/30'
              }`}
            >
              {/* Active ambient glow */}
              {isActive && (
                <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-app-primary/10 to-transparent pointer-events-none" />
              )}

              <div>
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`p-2.5 rounded-xl border text-sm ${isActive ? 'bg-app-primary/10 border-app-primary/20 text-app-primary' : 'bg-app-surface-hover border-app-border text-app-muted'}`}>
                      <User size={16} />
                    </div>
                    <h3 className="font-bold text-app-text text-base leading-tight">{profile.name}</h3>
                  </div>
                  
                  {isActive && (
                    <span className="px-2.5 py-0.5 bg-app-primary/10 border border-app-primary/20 text-app-primary text-[10px] font-bold rounded-full uppercase tracking-wider">
                      {t('profiles.active_badge')}
                    </span>
                  )}
                </div>
                
                {profile.linkedApps.length > 0 ? (
                  <div className="mt-3 space-y-1.5">
                    <span className="text-[10px] font-bold text-app-muted uppercase tracking-wider block">{t('profiles.linked_apps_title')}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {profile.linkedApps.map(app => (
                        <span key={app} className="flex items-center gap-1 text-[10px] bg-app-surface-hover text-app-muted px-2 py-1 rounded border border-app-border font-mono">
                          <AppWindow size={10} /> {app}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-app-muted/50 mt-3">{t('profiles.no_linked_apps')}</p>
                )}
              </div>

              {/* Actions */}
              <div className="flex space-x-2.5 mt-6 border-t border-app-border/60 pt-4 bg-transparent z-10">
                {!isActive && (
                  <button
                    onClick={() => setActiveProfile(profile.id)}
                    className="flex-1 py-2 text-xs font-semibold text-white bg-app-primary/10 hover:bg-app-primary/20 border border-app-primary/20 rounded-lg transition-colors cursor-pointer"
                  >
                    {t('profiles.btn_activate')}
                  </button>
                )}
                <button
                  onClick={() => setEditingProfile(profile)}
                  className="px-3.5 py-2 text-xs font-semibold text-app-muted hover:text-app-text bg-app-surface-hover hover:bg-app-border border border-app-border rounded-lg transition-colors cursor-pointer"
                >
                  {t('profiles.btn_edit')}
                </button>
                <button
                  onClick={() => deleteProfile(profile.id)}
                  className="px-3.5 py-2 text-xs font-semibold text-app-danger bg-app-danger/10 hover:bg-app-danger/20 border border-app-danger/20 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  disabled={profile.isDefault}
                >
                  {t('profiles.btn_delete')}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Editor Modal */}
      {editingProfile && (
        <div className="fixed inset-0 bg-app-bg/80 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
          <div className="bg-app-surface border border-app-border rounded-2xl shadow-2xl w-[420px] overflow-hidden flex flex-col glow-primary">
            <div className="p-6 border-b border-app-border bg-app-bg/40 flex justify-between items-center">
              <h3 className="text-lg font-bold text-app-text">{t('profiles.modal_edit_title')}</h3>
              <button onClick={() => setEditingProfile(null)} className="text-app-muted hover:text-app-text transition-colors cursor-pointer">
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-app-muted uppercase tracking-wider mb-2">{t('profiles.name_label')}</label>
                <input
                  type="text"
                  value={editingProfile.name}
                  onChange={(e) => setEditingProfile({ ...editingProfile, name: e.target.value })}
                  className="w-full bg-app-surface-hover border border-app-border text-sm text-app-text rounded-lg p-2.5 focus:outline-none focus:ring-1 focus:ring-app-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-app-muted uppercase tracking-wider mb-2">{t('profiles.linked_apps_label')}</label>
                <textarea
                  rows={3}
                  placeholder={t('profiles.linked_apps_placeholder')}
                  value={editingProfile.linkedApps.join('\n')}
                  onChange={(e) => setEditingProfile({ ...editingProfile, linkedApps: e.target.value.split('\n').filter(s => s.trim() !== '') })}
                  className="w-full bg-app-surface-hover border border-app-border text-xs text-app-text rounded-lg p-2.5 focus:outline-none focus:ring-1 focus:ring-app-primary font-mono leading-relaxed"
                />
              </div>
            </div>

            <div className="p-4 border-t border-app-border bg-app-bg/40 flex justify-end gap-2">
              <button
                onClick={() => setEditingProfile(null)}
                className="px-4 py-2 bg-app-surface-hover hover:bg-app-border border border-app-border text-sm font-semibold rounded-lg text-app-muted hover:text-app-text transition-colors cursor-pointer"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => { updateProfile(editingProfile.id, editingProfile); setEditingProfile(null); }}
                className="px-4 py-2 bg-app-primary hover:bg-app-primary-hover text-white text-sm font-semibold rounded-lg shadow-lg shadow-app-primary/20 transition-all cursor-pointer"
              >
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};