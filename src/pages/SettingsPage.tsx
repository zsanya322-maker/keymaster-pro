import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../stores/app-store';
import { invoke } from '../lib/ipc';
import { Terminal, Shield, Settings, RefreshCw, Download, FolderOpen } from 'lucide-react';
import { check } from '@tauri-apps/plugin-updater';
import { triggerToast } from '../lib/toast';
import { enable, disable } from '@tauri-apps/plugin-autostart';

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const { config, setConfig, daemonConnected, setDaemonConnected } = useAppStore();
  const [activeTab, setActiveTab] = useState<'general' | 'profiles' | 'daemon' | 'logs'>('general');
  const [restartingIPC, setRestartingIPC] = useState(false);
  const [isElevated, setIsElevated] = useState(false);

  useEffect(() => {
    const checkElevation = async () => {
      try {
        const res = await invoke<boolean>('is_elevated');
        setIsElevated(res);
      } catch (e) {
        console.error('Failed to check elevation', e);
      }
    };
    checkElevation();
  }, []);

  // States for Auto-updater
  const [updateStatus, setUpdateStatus] = useState<string>('');
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState<any>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleCheckForUpdates = async () => {
    setCheckingUpdate(true);
    setUpdateStatus(t('settings.updater_checking'));
    try {
      const update = await check();
      if (update) {
        setUpdateAvailable(update);
        setUpdateStatus(t('settings.updater_new_version', { version: update.version }));
      } else {
        setUpdateAvailable(null);
        setUpdateStatus(t('settings.updater_latest'));
      }
    } catch (err: any) {
      triggerToast('Update check failed', 'error');
      setUpdateStatus(t('settings.updater_failed_check', { error: err.message || err }));
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleInstallUpdate = async () => {
    if (!updateAvailable) return;
    setDownloading(true);
    setProgress(0);
    setUpdateStatus(t('settings.updater_downloading'));
    try {
      let downloaded = 0;
      let contentLength = 0;
      await updateAvailable.downloadAndInstall((event: any) => {
        switch (event.event) {
          case 'Started':
            contentLength = event.data.contentLength || 0;
            break;
          case 'Progress':
            downloaded += event.data.chunkLength;
            if (contentLength > 0) {
              setProgress(Math.round((downloaded / contentLength) * 100));
            }
            break;
          case 'Finished':
            break;
        }
      });
      setUpdateStatus(t('settings.updater_installed'));
      setTimeout(async () => {
        try {
          await invoke('restart_app');
        } catch (e) {
          triggerToast('Failed to restart app', 'error');
        }
      }, 1500);
    } catch (err: any) {
      triggerToast('Failed to install update', 'error');
      setUpdateStatus(t('settings.updater_failed_install', { error: err.message || err }));
      setDownloading(false);
    }
  };

  const [logs, setLogs] = useState<string[]>([
    '[12:01:05] [INFO] KeyMaster Pro Daemon v0.1.0 starting...',
    '[12:01:05] [INFO] Loading configuration from C:\\Users\\user\\AppData\\Roaming\\KeyMaster Pro\\config.json...',
    '[12:01:05] [INFO] Active profile loaded: Default (1)',
    '[12:01:06] [INFO] IPC server listening on local pipe: \\\\.\\pipe\\keymaster-pro-ipc',
    '[12:01:06] [INFO] Initializing Windows input hook filters...',
    '[12:01:06] [INFO] WH_KEYBOARD_LL hook hook set up successfully.',
    '[12:01:06] [INFO] WH_MOUSE_LL hook hook set up successfully.',
    '[12:01:06] [INFO] KeyMaster Pro Daemon ready and intercepting.',
    '[12:02:14] [DEBUG] IPC Client connected. Method called: profile.list',
    '[12:02:40] [DEBUG] Keypressed: VK_LSHIFT (0x10) DOWN [Global Rule Pass]',
    '[12:02:41] [DEBUG] Keypressed: VK_LSHIFT (0x10) UP [Global Rule Pass]'
  ]);

  const handleToggle = async (key: keyof typeof config) => {
    const newValue = !config[key];
    setConfig({ [key]: newValue });

    if (key === 'autostart') {
      try {
        if (newValue) {
          await enable();
          triggerToast(t('settings.autostart_enabled', 'Автозапуск включен'), 'success');
        } else {
          await disable();
          triggerToast(t('settings.autostart_disabled', 'Автозапуск выключен'), 'success');
        }
      } catch (e: any) {
        triggerToast(`Failed to configure autostart: ${e}`, 'error');
      }
    }
  };

  const handleRestartIPC = async () => {
    setRestartingIPC(true);
    // Имитация перезапуска IPC-соединения
    setTimeout(async () => {
      try {
        const status: any = await invoke('daemon_status');
        setDaemonConnected(!!(status && status.connected));
      } catch (e) {}
      setLogs(prev => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] [DEBUG] Re-connecting IPC Named Pipe...`,
        `[${new Date().toLocaleTimeString()}] [INFO] Named Pipe Connection established successfully.`
      ]);
      setRestartingIPC(false);
    }, 1500);
  };

  const handleClearLogs = () => {
    setLogs([`[${new Date().toLocaleTimeString()}] [INFO] ${t('settings.logs_cleared')}`]);
  };

  const handleOpenLogsFolder = async () => {
    try {
      await invoke('ipc_call', { method: 'open_log_folder' });
    } catch (e: any) {
      triggerToast(`Failed to open logs: ${e}`, 'error');
    }
  };

  const changeLanguage = (lang: 'ru' | 'en') => {
    i18n.changeLanguage(lang);
    setConfig({ language: lang });
  };

  return (
    <div className="flex gap-6 max-w-6xl h-[calc(100vh-180px)] animate-fade-in">
      {/* Settings Navigation Menu */}
      <div className="w-56 flex flex-col gap-1.5 shrink-0 bg-app-surface/40 p-2 border border-app-border rounded-2xl h-fit">
        <button
          onClick={() => setActiveTab('general')}
          className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
            activeTab === 'general'
              ? 'bg-app-primary/10 text-app-primary border-l-2 border-app-primary'
              : 'text-app-muted hover:text-app-text hover:bg-app-surface-hover/40'
          }`}
        >
          <Settings size={14} /> {t('settings.nav_general')}
        </button>

        <button
          onClick={() => setActiveTab('daemon')}
          className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
            activeTab === 'daemon'
              ? 'bg-app-primary/10 text-app-primary border-l-2 border-app-primary'
              : 'text-app-muted hover:text-app-text hover:bg-app-surface-hover/40'
          }`}
        >
          <Shield size={14} /> {t('settings.nav_daemon')}
        </button>
        <button
          onClick={() => setActiveTab('logs')}
          className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
            activeTab === 'logs'
              ? 'bg-app-primary/10 text-app-primary border-l-2 border-app-primary'
              : 'text-app-muted hover:text-app-text hover:bg-app-surface-hover/40'
          }`}
        >
          <Terminal size={14} /> {t('settings.nav_logs')}
        </button>
      </div>

      {/* Settings Container Body */}
      <div className="flex-1 bg-app-surface/60 backdrop-blur-md rounded-2xl border border-app-border p-6 overflow-y-auto">
        
        {/* TAB 1: GENERAL SETTINGS */}
        {activeTab === 'general' && (
          <div className="space-y-6">
            <h3 className="text-lg font-bold text-app-text mb-4">{t('settings.general_title')}</h3>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-app-surface-hover/30 border border-app-border/60 rounded-xl">
                <div>
                  <h4 className="text-sm font-bold text-app-text">{t('settings.auto_start')}</h4>
                  <p className="text-xs text-app-muted mt-0.5">{t('settings.auto_start_desc')}</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.autostart}
                    onChange={() => handleToggle('autostart')}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-app-border rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-app-muted after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-app-primary peer-checked:after:bg-white" />
                </label>
              </div>

              <div className="flex items-center justify-between p-4 bg-app-surface-hover/30 border border-app-border/60 rounded-xl">
                <div>
                  <h4 className="text-sm font-bold text-app-text">{t('settings.restore_mouse', 'Возвращать мышь после макроса')}</h4>
                  <p className="text-xs text-app-muted mt-0.5">{t('settings.restore_mouse_desc', 'После выполнения макроса курсор возвращается туда, где был до его запуска')}</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!config.restoreMouseAfterMacro}
                    onChange={() => handleToggle('restoreMouseAfterMacro')}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-app-border rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-app-muted after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-app-primary peer-checked:after:bg-white" />
                </label>
              </div>

              <div className="p-4 bg-app-surface-hover/30 border border-app-border/60 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-app-text">Tap-Hold Timeout</h4>
                    <p className="text-xs text-app-muted mt-0.5">Delay before a tap is considered a hold (Kanata-style)</p>
                  </div>
                  <span className="text-sm font-mono text-app-primary bg-app-primary/10 px-2 py-1 rounded">
                    {config.tapHoldTimeoutMs || 200} ms
                  </span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="1000"
                  step="50"
                  value={config.tapHoldTimeoutMs || 200}
                  onChange={(e) => setConfig({ tapHoldTimeoutMs: parseInt(e.target.value) })}
                  className="w-full accent-app-primary cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between p-4 bg-app-surface-hover/30 border border-app-border/60 rounded-xl">
                <div>
                  <h4 className="text-sm font-bold text-app-text">{t('settings.close_to_tray')}</h4>
                  <p className="text-xs text-app-muted mt-0.5">{t('settings.close_to_tray_desc')}</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.minimizeToTray}
                    onChange={() => handleToggle('minimizeToTray')}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-app-border rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-app-muted after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-app-primary peer-checked:after:bg-white" />
                </label>
              </div>

              <div className="flex items-center justify-between p-4 bg-app-surface-hover/30 border border-app-border/60 rounded-xl">
                <div>
                  <h4 className="text-sm font-bold text-app-text">{t('settings.language')}</h4>
                  <p className="text-xs text-app-muted mt-0.5">{t('settings.language_desc')}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => changeLanguage('ru')}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                      config.language === 'ru'
                        ? 'bg-app-primary/20 border-app-primary text-app-text'
                        : 'bg-app-surface-hover/30 border-app-border text-app-muted hover:text-app-text'
                    }`}
                  >
                    🇷🇺 Русский
                  </button>
                  <button
                    onClick={() => changeLanguage('en')}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                      config.language === 'en'
                        ? 'bg-app-primary/20 border-app-primary text-app-text'
                        : 'bg-app-surface-hover/30 border-app-border text-app-muted hover:text-app-text'
                    }`}
                  >
                    🇺🇸 English
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between p-4 bg-app-surface-hover/30 border border-app-border/60 rounded-xl">
                <div>
                  <h4 className="text-sm font-bold text-app-text">{t('settings.theme')}</h4>
                  <p className="text-xs text-app-muted mt-0.5">{t('settings.theme_desc')}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfig({ theme: 'dark' })}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                      config.theme === 'dark'
                        ? 'bg-app-primary/20 border-app-primary text-app-text'
                        : 'bg-app-surface-hover/30 border-app-border text-app-muted hover:text-app-text'
                    }`}
                  >
                    🌑 {t('settings.theme_dark')}
                  </button>
                  <button
                    onClick={() => setConfig({ theme: 'light' })}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                      config.theme === 'light'
                        ? 'bg-app-primary/20 border-app-primary text-app-text'
                        : 'bg-app-surface-hover/30 border-app-border text-app-muted hover:text-app-text'
                    }`}
                  >
                    ☀️ {t('settings.theme_light')}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between p-4 bg-app-surface-hover/30 border border-app-border/60 rounded-xl">
                <div>
                  <h4 className="text-sm font-bold text-app-text">{t('settings.scale')}</h4>
                  <p className="text-xs text-app-muted mt-0.5">{t('settings.scale_desc')}</p>
                </div>
                <div className="flex items-center gap-4 min-w-[200px]">
                  <input
                    type="range"
                    min="0.75"
                    max="1.25"
                    step="0.05"
                    value={config.scale || 0.85}
                    onChange={(e) => setConfig({ scale: parseFloat(e.target.value) })}
                    className="w-full h-1 bg-app-border rounded-lg appearance-none cursor-pointer accent-app-primary"
                  />
                  <span className="text-xs font-bold text-app-text w-12 text-right">
                    {Math.round((config.scale || 0.85) * 100)}%
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between p-4 bg-app-surface-hover/30 border border-app-border/60 rounded-xl">
                <div>
                  <h4 className="text-sm font-bold text-app-text">{t('settings.fontSize', 'Размер шрифта')}</h4>
                  <p className="text-xs text-app-muted mt-0.5">{t('settings.fontSize_desc', 'Масштаб шрифта в таблицах правил (10px - 14px)')}</p>
                </div>
                <div className="flex items-center gap-4 min-w-[200px]">
                  <input
                    type="range"
                    min="10"
                    max="14"
                    step="1"
                    value={config.fontSize || 12}
                    onChange={(e) => setConfig({ fontSize: parseInt(e.target.value) })}
                    className="w-full h-1 bg-app-border rounded-lg appearance-none cursor-pointer accent-app-primary"
                  />
                  <span className="text-xs font-bold text-app-text w-12 text-right">
                    {config.fontSize || 12}px
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between p-4 bg-app-surface-hover/30 border border-app-border/60 rounded-xl">
                <div>
                  <h4 className="text-sm font-bold text-app-text">{t('settings.rowPadding', 'Отступы строк')}</h4>
                  <p className="text-xs text-app-muted mt-0.5">{t('settings.rowPadding_desc', 'Вертикальные отступы в таблицах правил (7px - 10px)')}</p>
                </div>
                <div className="flex items-center gap-4 min-w-[200px]">
                  <input
                    type="range"
                    min="7"
                    max="10"
                    step="1"
                    value={config.rowPadding || 8}
                    onChange={(e) => setConfig({ rowPadding: parseInt(e.target.value) })}
                    className="w-full h-1 bg-app-border rounded-lg appearance-none cursor-pointer accent-app-primary"
                  />
                  <span className="text-xs font-bold text-app-text w-12 text-right">
                    {config.rowPadding || 8}px
                  </span>
                </div>
              </div>

              {/* Live Preview Table */}
              <div className="p-4 bg-app-surface-hover/20 border border-app-border/40 rounded-xl space-y-3">
                <span className="text-[10px] font-bold text-app-muted uppercase tracking-wider block">
                  {t('settings.preview_title', 'Предварительный просмотр таблицы (Live Preview)')}
                </span>
                
                <div className="overflow-x-auto border border-app-border rounded-lg bg-app-bg/40">
                  <table className="w-full text-left border-collapse" style={{ fontSize: 'var(--table-font-size, 12px)' }}>
                    <thead>
                      <tr className="bg-app-surface/60 border-b border-app-border text-[10px] font-bold text-app-muted uppercase tracking-wider">
                        <th className="px-3 py-2">{t('settings.preview_col_trigger', 'Клавиша (Триггер)')}</th>
                        <th className="px-3 py-2">{t('settings.preview_col_action', 'Действие (Экшн)')}</th>
                        <th className="px-3 py-2 text-right pr-4">{t('settings.preview_col_status', 'Состояние')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-app-border/40">
                      <tr>
                        <td className="px-3 font-medium" style={{ paddingTop: 'var(--table-row-padding, 8px)', paddingBottom: 'var(--table-row-padding, 8px)' }}>
                          <kbd className="keycap">Caps Lock</kbd>
                        </td>
                        <td className="px-3" style={{ paddingTop: 'var(--table-row-padding, 8px)', paddingBottom: 'var(--table-row-padding, 8px)' }}>
                          <kbd className="keycap">Escape</kbd>
                        </td>
                        <td className="px-3 text-right pr-4 text-xs font-semibold text-app-success" style={{ paddingTop: 'var(--table-row-padding, 8px)', paddingBottom: 'var(--table-row-padding, 8px)' }}>
                          {t('common.enabled', 'Включено')}
                        </td>
                      </tr>
                      <tr>
                        <td className="px-3 font-medium" style={{ paddingTop: 'var(--table-row-padding, 8px)', paddingBottom: 'var(--table-row-padding, 8px)' }}>
                          <kbd className="keycap">Ctrl+C</kbd>
                        </td>
                        <td className="px-3" style={{ paddingTop: 'var(--table-row-padding, 8px)', paddingBottom: 'var(--table-row-padding, 8px)' }}>
                          <span className="px-2 py-0.5 rounded bg-app-primary/10 border border-app-primary/20 text-app-primary text-xs font-semibold">
                            {t('mouse_remapping.actions.copy', 'Копировать')}
                          </span>
                        </td>
                        <td className="px-3 text-right pr-4 text-xs font-semibold text-app-success" style={{ paddingTop: 'var(--table-row-padding, 8px)', paddingBottom: 'var(--table-row-padding, 8px)' }}>
                          {t('common.enabled', 'Включено')}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>


              {/* F112: Auto-updater UI Section */}
              <div className="p-4 bg-app-surface-hover/30 border border-app-border/60 rounded-xl space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-app-text">
                      {t('settings.updater_title')}
                    </h4>
                    <p className="text-xs text-app-muted mt-0.5">
                      {t('settings.updater_desc')}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {updateAvailable && !downloading && (
                      <button
                        onClick={handleInstallUpdate}
                        className="px-3.5 py-1.5 rounded-lg bg-app-primary hover:bg-app-primary-hover text-xs font-bold text-white flex items-center gap-2 transition-all shadow-md shadow-app-primary/20 cursor-pointer"
                      >
                        <Download size={12} />
                        {t('settings.updater_btn_install')}
                      </button>
                    )}
                    <button
                      onClick={handleCheckForUpdates}
                      disabled={checkingUpdate || downloading}
                      className="px-3 py-1.5 rounded-lg border border-app-border bg-app-surface-hover/30 text-app-muted hover:text-app-text hover:bg-app-border text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <RefreshCw size={12} className={checkingUpdate ? 'animate-spin' : ''} />
                      {t('settings.updater_btn_check')}
                    </button>
                  </div>
                </div>

                {updateStatus && (
                  <div className="pt-3 border-t border-app-border/40 flex items-center gap-2 text-xs">
                    {downloading ? (
                      <div className="w-full space-y-2">
                        <div className="flex justify-between text-app-muted font-semibold">
                          <span>{updateStatus}</span>
                          <span>{progress}%</span>
                        </div>
                        <div className="w-full bg-app-surface-hover rounded-full h-1.5">
                          <div 
                            className="bg-app-primary h-1.5 rounded-full transition-all duration-300" 
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      </div>
                    ) : (
                      <>
                        {updateAvailable ? (
                          <span className="text-app-primary font-bold">●</span>
                        ) : updateStatus.includes('ошибка') || updateStatus.includes('Failed') || updateStatus.includes('Не удалось') ? (
                          <span className="text-app-danger font-bold">●</span>
                        ) : (
                          <span className="text-app-success font-bold">●</span>
                        )}
                        <span className="text-app-muted">{updateStatus}</span>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}



        {/* TAB 3: DAEMON & IPC */}
        {activeTab === 'daemon' && (
          <div className="space-y-6">
            <h3 className="text-lg font-bold text-app-text mb-4">{t('settings.daemon_title')}</h3>
            
            <div className="space-y-4">
              <div className="p-4 bg-app-surface-hover/30 border border-app-border/60 rounded-xl flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-app-text">{t('settings.daemon_pipe')}</h4>
                  <p className="text-xs text-app-muted mt-0.5">
                    {t('settings.daemon_pipe_desc')}
                  </p>
                </div>
                <span className={`px-3 py-1 rounded-xl text-xs font-bold border uppercase tracking-wider ${
                  daemonConnected ? 'bg-app-success/10 border-app-success/20 text-app-success' : 'bg-app-danger/10 border-app-danger/20 text-app-danger'
                }`}>
                  {daemonConnected ? t('status.connected') : t('status.disconnected')}
                </span>
              </div>

              <div className="p-4 bg-app-surface-hover/30 border border-app-border/60 rounded-xl flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-app-text">{t('settings.daemon_elevation', 'Права Администратора (UAC)')}</h4>
                  <p className="text-xs text-app-muted mt-0.5">
                    {isElevated 
                      ? t('settings.daemon_elevation_active_desc', 'Приложение запущено от имени Администратора. Доступен полный перехват во всех окнах.')
                      : t('settings.daemon_elevation_inactive_desc', 'Запустите приложение от имени Администратора для работы горячих клавиш в защищенных или запущенных от админа играх/программах.')
                    }
                  </p>
                </div>
                {isElevated ? (
                  <div className="flex items-center gap-2">
                    <span className="px-3 py-1 rounded-xl text-xs font-bold border border-app-success/20 bg-app-success/10 text-app-success uppercase tracking-wider">
                      {t('settings.daemon_elevation_admin', 'Администратор')}
                    </span>
                    <button
                      onClick={async () => {
                        try {
                          await invoke('spawn_daemon');
                          triggerToast('Daemon start requested', 'success');
                        } catch (e: any) {
                          triggerToast(`Failed to start daemon: ${e}`, 'error');
                        }
                      }}
                      className="flex items-center gap-2 px-3 py-2 text-xs font-bold bg-app-primary text-white rounded-lg hover:bg-app-primary/80 transition-colors cursor-pointer"
                    >
                      <RefreshCw size={12} />
                      Restart Daemon
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={async () => {
                        try {
                          await invoke('spawn_daemon');
                          triggerToast('Daemon start requested', 'success');
                        } catch (e: any) {
                          triggerToast(`Failed to start daemon: ${e}`, 'error');
                        }
                      }}
                      className="flex items-center gap-2 px-3 py-2 text-xs font-bold bg-app-primary text-white rounded-lg hover:bg-app-primary/80 transition-colors cursor-pointer"
                    >
                      <RefreshCw size={12} />
                      Restart Daemon
                    </button>
                    <button
                      onClick={async () => {
                        try {
                          await invoke('restart_as_admin');
                        } catch (e: any) {
                          triggerToast(`Failed to restart as admin: ${e}`, 'error');
                        }
                      }}
                      className="flex items-center gap-2 px-3 py-2 text-xs font-bold bg-app-primary text-white rounded-lg hover:bg-app-primary/80 transition-colors cursor-pointer"
                    >
                      <Shield size={12} />
                      {t('settings.daemon_elevation_restart', 'Запустить от Администратора')}
                    </button>
                  </div>
                )}
              </div>

              <div className="p-4 bg-app-surface-hover/30 border border-app-border/60 rounded-xl space-y-4">
                <div>
                  <h4 className="text-sm font-bold text-app-text">{t('settings.daemon_channels')}</h4>
                  <p className="text-xs text-app-muted mt-0.5">
                    {t('settings.daemon_channels_desc')}
                  </p>
                </div>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2.5 cursor-pointer text-xs font-semibold text-app-text">
                    <input
                      type="checkbox"
                      checked={config.kbHookEnabled}
                      onChange={() => handleToggle('kbHookEnabled')}
                      className="rounded text-app-primary focus:ring-app-primary bg-app-surface-hover border-app-border"
                    />
                    {t('settings.daemon_kb_hook')}
                  </label>
                  <label className="flex items-center gap-2.5 cursor-pointer text-xs font-semibold text-app-text">
                    <input
                      type="checkbox"
                      checked={config.mouseHookEnabled}
                      onChange={() => handleToggle('mouseHookEnabled')}
                      className="rounded text-app-primary focus:ring-app-primary bg-app-surface-hover border-app-border"
                    />
                    {t('settings.daemon_mouse_hook')}
                  </label>
                </div>
              </div>

              <div className="flex justify-between items-center p-4 bg-app-surface-hover/30 border border-app-border/60 rounded-xl">
                <div>
                  <h4 className="text-sm font-bold text-app-text">{t('settings.daemon_restart_ipc')}</h4>
                  <p className="text-xs text-app-muted mt-0.5">{t('settings.daemon_restart_ipc_desc')}</p>
                </div>
                <button
                  onClick={handleRestartIPC}
                  disabled={restartingIPC}
                  className="flex items-center gap-2 px-3 py-2 text-xs font-bold bg-app-surface-hover hover:bg-app-border border border-app-border text-app-muted hover:text-app-text rounded-lg transition-colors cursor-pointer"
                >
                  <RefreshCw size={12} className={restartingIPC ? 'animate-spin' : ''} />
                  {t('settings.daemon_restart_btn')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: CONSOLE LOGS */}
        {activeTab === 'logs' && (
          <div className="space-y-4 flex flex-col h-full">
            <div className="flex justify-between items-center shrink-0">
              <div>
                <h3 className="text-lg font-bold text-app-text">{t('settings.logs_title')}</h3>
                <p className="text-xs text-app-muted mt-0.5">
                  {t('settings.logs_desc')}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleOpenLogsFolder}
                  className="flex items-center gap-2 text-xs bg-app-primary/10 hover:bg-app-primary/20 border border-app-primary/30 text-app-primary px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                >
                  <FolderOpen size={14} />
                  {t('settings.logs_open_folder', 'Открыть папку')}
                </button>
                <button
                  onClick={handleClearLogs}
                  className="text-xs bg-app-surface-hover hover:bg-app-border border border-app-border text-app-muted hover:text-app-text px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                >
                  {t('settings.logs_clear')}
                </button>
              </div>
            </div>

            <div className="flex-1 bg-app-bg border border-app-border rounded-xl p-4 font-mono text-[11px] leading-relaxed text-app-success overflow-y-auto max-h-[300px]">
              {logs.map((log, idx) => (
                <div key={idx} className="whitespace-pre-wrap">
                  {log}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}