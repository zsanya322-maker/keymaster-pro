import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MacrosPage } from './MacrosPage';
import { TextExpansionsPage } from './TextExpansionsPage';

export const AutomationPage: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'macros' | 'expansions'>('macros');

  return (
    <div className="flex flex-col gap-4 h-full animate-fade-in">
      {/* Top Tabs */}
      <div className="flex border border-app-border bg-app-surface/40 backdrop-blur-md rounded-xl p-1.5 w-fit">
        <button
          onClick={() => setActiveTab('macros')}
          className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${
            activeTab === 'macros'
              ? 'bg-app-primary text-white shadow-md glow-primary'
              : 'text-app-muted hover:text-app-text'
          }`}
        >
          🎬 {t('nav.macros')}
        </button>
        <button
          onClick={() => setActiveTab('expansions')}
          className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${
            activeTab === 'expansions'
              ? 'bg-app-primary text-white shadow-md glow-primary'
              : 'text-app-muted hover:text-app-text'
          }`}
        >
          📝 {t('nav.text_expansions')}
        </button>
      </div>

      {/* Main Tab Content */}
      <div className="bg-app-surface/60 backdrop-blur-md border border-app-border rounded-2xl p-5 flex-1 min-h-0">
        {activeTab === 'macros' ? <MacrosPage /> : <TextExpansionsPage />}
      </div>
    </div>
  );
};
