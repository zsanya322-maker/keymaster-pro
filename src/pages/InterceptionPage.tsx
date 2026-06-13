import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RemappingPage } from './RemappingPage';
import { MouseRemappingPage } from './MouseRemappingPage';
import { LayersPage } from './LayersPage';

export const InterceptionPage: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'keyboard' | 'mouse'>('keyboard');

  return (
    <div className="flex flex-col lg:flex-row gap-5 h-full animate-fade-in">
      {/* Left Column: Remapping tabs (Keyboard & Mouse) */}
      <div className="flex-1 space-y-4 min-w-0">
        <div className="flex border border-app-border bg-app-surface/40 backdrop-blur-md rounded-xl p-1.5 w-fit">
          <button
            onClick={() => setActiveTab('keyboard')}
            className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${
              activeTab === 'keyboard'
                ? 'bg-app-primary text-white shadow-md glow-primary'
                : 'text-app-muted hover:text-app-text'
            }`}
          >
            ⌨️ {t('nav.remapping')}
          </button>
          <button
            onClick={() => setActiveTab('mouse')}
            className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${
              activeTab === 'mouse'
                ? 'bg-app-primary text-white shadow-md glow-primary'
                : 'text-app-muted hover:text-app-text'
            }`}
          >
            🖱️ {t('nav.mouse_remapping')}
          </button>
        </div>

        <div className="bg-app-surface/60 backdrop-blur-md border border-app-border rounded-2xl p-5">
          {activeTab === 'keyboard' ? <RemappingPage /> : <MouseRemappingPage />}
        </div>
      </div>

      {/* Right Column: Sidebar for Layers management */}
      <div className="w-full lg:w-96 shrink-0">
        <div className="bg-app-surface/60 backdrop-blur-md border border-app-border rounded-2xl p-5 h-full">
          <LayersPage />
        </div>
      </div>
    </div>
  );
};
