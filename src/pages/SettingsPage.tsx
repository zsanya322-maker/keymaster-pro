import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { check } from '@tauri-apps/plugin-updater';
import { disable, enable } from '@tauri-apps/plugin-autostart';
import {
  Download,
  FolderOpen,
  RefreshCw,
  Settings,
  Shield,
  Terminal,
} from 'lucide-react';
import { useAppStore } from '../stores/app-store';
import { invoke } from '../lib/ipc';
import { triggerToast } from '../lib/toast';

type SettingsTab = 'general' | 'daemon' | 'logs';

interface SettingRowProps {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  stacked?: boolean;
}

function SettingRow({ title, description, children, stacked = false }: SettingRowProps) {
  return (
    <div className={`border-b border-app-border/60 last:border-b-0 ${stacked ? 'py-3' : 'min-h-14 py-2.5'} px-3`}>
      <div className={stacked ? 'space-y-2.5' : 'grid grid-cols-[minmax(220px,1fr)_minmax(220px,320px)] gap-6 items-center'}>
        <div className="min-w-0">
          <div className="text-xs font-medium text-app-text">{title}</div>
          {description && <div className="mt-0.5 text-[11px] leading-4 text-app-muted">{description}</div>}
        </div>
        <div className={stacked ? '' : 'justify-self-stretch'}>{children}</div>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, disabled = false }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <label className={`relative inline-flex items-center ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="sr-only peer"
      />
      <span className="relative h-[18px] w-8 rounded-full border border-app-border bg-app-surface-hover transition-colors peer-checked:border-app-primary peer-checked:bg-app-primary/80">
        <span className="absolute left-[2px] top-[2px] h-3 w-3 rounded-full bg-app-muted transition-transform peer-checked:translate-x-[14px] peer-checked:bg-white" />
      </span>
    </label>
  );
}

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="border border-app-border bg-app-bg">
      <div className="h-8 px-3 flex items-center border-b border-app-border bg-app-surface/55 text-[11px] font-semibold text-app-text">
        {title}
      </div>
      {children}
    </section>
  );
}

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const { config, setConfig, daemonConnected } = useAppStore();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [isElevated, setIsElevated] = useState(false);

  const [updateStatus, setUpdateStatus] = useState('');
  const [updateError, setUpdateError] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState<any>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);

  const [logs, setLogs] = useState<string[]>([
    '[12:01:05] [INFO] KeyMaster Pro Daemon v0.1.0 starting...',
    '[12:01:05] [INFO] Loading configuration from C:\\Users\\user\\AppData\\Roaming\\KeyMaster Pro\\config.json...',
    '[12:01:05] [INFO] Active profile loaded: Default (1)',
    '[12:01:06] [INFO] IPC server listening on local pipe: \\\\.\\pipe\\keymaster-pro-ipc',
    '[12:01:06] [INFO] Initializing Windows input hook filters...',
    '[12:01:06] [INFO] WH_KEYBOARD_LL hook set up successfully.',
    '[12:01:06] [INFO] WH_MOUSE_LL hook set up successfully.',
    '[12:01:06] [INFO] KeyMaster Pro Daemon ready and intercepting.',
  ]);

  useEffect(() => {
    invoke<boolean>('is_elevated')
      .then(setIsElevated)
      .catch((error) => console.error('Failed to check elevation', error));
  }, []);

  const handleToggle = async (key: keyof typeof config) => {
    const previousValue = config[key];
    const newValue = !previousValue;
    setConfig({ [key]: newValue });

    if (key !== 'autostart') return;

    try {
      if (newValue) {
        await enable();
        triggerToast(t('settings.autostart_enabled'), 'success');
      } else {
        await disable();
        triggerToast(t('settings.autostart_disabled'), 'success');
      }
    } catch (error: any) {
      setConfig({ autostart: Boolean(previousValue) });
      triggerToast(t('settings.toast_autostart_failed', { error }), 'error');
    }
  };

  const changeLanguage = (language: 'ru' | 'en') => {
    void i18n.changeLanguage(language);
    setConfig({ language });
  };

  const handleCheckForUpdates = async () => {
    setCheckingUpdate(true);
    setUpdateStatus(t('settings.updater_checking'));
    setUpdateError(false);

    try {
      const update = await check();
      if (update) {
        setUpdateAvailable(update);
        setUpdateStatus(t('settings.updater_new_version', { version: update.version }));
      } else {
        setUpdateAvailable(null);
        setUpdateStatus(t('settings.updater_latest'));
      }
    } catch (error: any) {
      triggerToast(t('settings.toast_update_check_failed'), 'error');
      setUpdateStatus(t('settings.updater_failed_check', { error: error?.message || error }));
      setUpdateError(true);
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleInstallUpdate = async () => {
    if (!updateAvailable) return;

    setDownloading(true);
    setProgress(0);
    setUpdateStatus(t('settings.updater_downloading'));
    setUpdateError(false);

    try {
      let downloaded = 0;
      let contentLength = 0;
      await updateAvailable.downloadAndInstall((event: any) => {
        if (event.event === 'Started') {
          contentLength = event.data.contentLength || 0;
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          if (contentLength > 0) setProgress(Math.round((downloaded / contentLength) * 100));
        }
      });

      setUpdateStatus(t('settings.updater_installed'));
      setTimeout(() => {
        invoke('restart_app').catch(() => triggerToast(t('settings.toast_restart_failed'), 'error'));
      }, 1500);
    } catch (error: any) {
      triggerToast(t('settings.toast_install_failed'), 'error');
      setUpdateStatus(t('settings.updater_failed_install', { error: error?.message || error }));
      setUpdateError(true);
      setDownloading(false);
    }
  };

  const handleRestartDaemon = async () => {
    try {
      await invoke('spawn_daemon');
      triggerToast(t('settings.toast_daemon_start_requested'), 'success');
    } catch (error: any) {
      triggerToast(t('settings.toast_daemon_start_failed', { error }), 'error');
    }
  };

  const handleRestartAsAdmin = async () => {
    try {
      await invoke('restart_as_admin');
    } catch (error: any) {
      triggerToast(t('settings.toast_admin_restart_failed', { error }), 'error');
    }
  };

  const handleOpenLogsFolder = async () => {
    try {
      await invoke('ipc_call', { method: 'open_log_folder' });
    } catch (error: any) {
      triggerToast(t('settings.toast_open_logs_failed', { error }), 'error');
    }
  };

  const navItems: Array<{ id: SettingsTab; label: string; icon: typeof Settings }> = [
    { id: 'general', label: t('settings.nav_general'), icon: Settings },
    { id: 'daemon', label: t('settings.nav_daemon'), icon: Shield },
    { id: 'logs', label: t('settings.nav_logs'), icon: Terminal },
  ];

  return (
    <div className="h-full min-h-0 flex bg-app-bg overflow-hidden">
      <aside className="w-48 shrink-0 border-r border-app-border bg-app-surface/25 flex flex-col">
        <div className="h-11 px-3 flex items-center border-b border-app-border bg-app-surface/45">
          <span className="text-sm font-semibold text-app-text">{t('nav.settings', 'Настройки')}</span>
        </div>
        <nav className="py-1.5">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`w-full h-9 px-3 flex items-center gap-2.5 text-xs text-left border-l-2 transition-colors ${
                activeTab === id
                  ? 'border-app-primary bg-app-primary/8 text-app-text'
                  : 'border-transparent text-app-muted hover:text-app-text hover:bg-app-surface-hover/45'
              }`}
            >
              <Icon size={14} className={activeTab === id ? 'text-app-primary' : ''} />
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="flex-1 min-w-0 min-h-0 flex flex-col">
        <div className="h-11 px-4 flex items-center border-b border-app-border bg-app-surface/45 shrink-0">
          <h2 className="text-sm font-semibold text-app-text">
            {activeTab === 'general'
              ? t('settings.general_title')
              : activeTab === 'daemon'
                ? t('settings.daemon_title')
                : t('settings.logs_title')}
          </h2>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {activeTab === 'general' && (
            <div className="max-w-4xl space-y-4">
              <Section title={t('settings.general_title')}>
                <SettingRow title={t('settings.auto_start')} description={t('settings.auto_start_desc')}>
                  <div className="flex justify-end"><Toggle checked={config.autostart} onChange={() => void handleToggle('autostart')} /></div>
                </SettingRow>
                <SettingRow title={t('settings.restore_mouse')} description={t('settings.restore_mouse_desc')}>
                  <div className="flex justify-end"><Toggle checked={Boolean(config.restoreMouseAfterMacro)} onChange={() => void handleToggle('restoreMouseAfterMacro')} /></div>
                </SettingRow>
                <SettingRow title={t('settings.close_to_tray')} description={t('settings.close_to_tray_desc')}>
                  <div className="flex justify-end"><Toggle checked={config.minimizeToTray} onChange={() => void handleToggle('minimizeToTray')} /></div>
                </SettingRow>
                <SettingRow title={t('settings.tap_hold_timeout')} description={t('settings.tap_hold_timeout_desc')}>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min="50"
                      max="1000"
                      step="50"
                      value={config.tapHoldTimeoutMs || 200}
                      onChange={(event) => setConfig({ tapHoldTimeoutMs: Number.parseInt(event.target.value, 10) })}
                      className="flex-1 accent-app-primary"
                    />
                    <span className="w-16 text-right text-xs font-mono text-app-text">{config.tapHoldTimeoutMs || 200} ms</span>
                  </div>
                </SettingRow>
              </Section>

              <Section title={t('settings.language')}>
                <SettingRow title={t('settings.language')} description={t('settings.language_desc')}>
                  <select
                    value={config.language}
                    onChange={(event) => changeLanguage(event.target.value as 'ru' | 'en')}
                    className="h-8 w-full border border-app-border bg-app-bg px-2 text-xs text-app-text outline-none focus:border-app-primary"
                  >
                    <option value="ru">Русский</option>
                    <option value="en">English</option>
                  </select>
                </SettingRow>
                <SettingRow title={t('settings.theme')} description={t('settings.theme_desc')}>
                  <select
                    value={config.theme}
                    onChange={(event) => setConfig({ theme: event.target.value as 'dark' | 'light' })}
                    className="h-8 w-full border border-app-border bg-app-bg px-2 text-xs text-app-text outline-none focus:border-app-primary"
                  >
                    <option value="dark">{t('settings.theme_dark')}</option>
                    <option value="light">{t('settings.theme_light')}</option>
                  </select>
                </SettingRow>
              </Section>

              <Section title={t('settings.scale')}>
                <SettingRow title={t('settings.scale')} description={t('settings.scale_desc')}>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min="0.75"
                      max="1.25"
                      step="0.05"
                      value={config.scale || 0.85}
                      onChange={(event) => setConfig({ scale: Number.parseFloat(event.target.value) })}
                      className="flex-1 accent-app-primary"
                    />
                    <span className="w-12 text-right text-xs font-mono text-app-text">{Math.round((config.scale || 0.85) * 100)}%</span>
                  </div>
                </SettingRow>
                <SettingRow title={t('settings.fontSize')} description={t('settings.fontSize_desc')}>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min="10"
                      max="14"
                      step="1"
                      value={config.fontSize || 12}
                      onChange={(event) => setConfig({ fontSize: Number.parseInt(event.target.value, 10) })}
                      className="flex-1 accent-app-primary"
                    />
                    <span className="w-12 text-right text-xs font-mono text-app-text">{config.fontSize || 12}px</span>
                  </div>
                </SettingRow>
                <SettingRow title={t('settings.rowPadding')} description={t('settings.rowPadding_desc')}>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min="7"
                      max="10"
                      step="1"
                      value={config.rowPadding || 8}
                      onChange={(event) => setConfig({ rowPadding: Number.parseInt(event.target.value, 10) })}
                      className="flex-1 accent-app-primary"
                    />
                    <span className="w-12 text-right text-xs font-mono text-app-text">{config.rowPadding || 8}px</span>
                  </div>
                </SettingRow>
                <SettingRow title={t('settings.preview_title')} stacked>
                  <div className="border border-app-border bg-app-bg overflow-hidden">
                    <table className="w-full text-left border-collapse" style={{ fontSize: 'var(--table-font-size, 12px)' }}>
                      <thead>
                        <tr className="h-8 border-b border-app-border bg-app-surface/55 text-[10px] text-app-muted">
                          <th className="px-3 font-medium">{t('settings.preview_col_trigger')}</th>
                          <th className="px-3 font-medium">{t('settings.preview_col_action')}</th>
                          <th className="px-3 font-medium text-right">{t('settings.preview_col_status')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b border-app-border/50">
                          <td className="px-3" style={{ paddingTop: 'var(--table-row-padding, 8px)', paddingBottom: 'var(--table-row-padding, 8px)' }}><kbd className="keycap">Caps Lock</kbd></td>
                          <td className="px-3" style={{ paddingTop: 'var(--table-row-padding, 8px)', paddingBottom: 'var(--table-row-padding, 8px)' }}><kbd className="keycap">Escape</kbd></td>
                          <td className="px-3 text-right text-app-success" style={{ paddingTop: 'var(--table-row-padding, 8px)', paddingBottom: 'var(--table-row-padding, 8px)' }}>{t('common.enabled')}</td>
                        </tr>
                        <tr>
                          <td className="px-3" style={{ paddingTop: 'var(--table-row-padding, 8px)', paddingBottom: 'var(--table-row-padding, 8px)' }}><kbd className="keycap">Ctrl+C</kbd></td>
                          <td className="px-3" style={{ paddingTop: 'var(--table-row-padding, 8px)', paddingBottom: 'var(--table-row-padding, 8px)' }}>{t('common.copy')}</td>
                          <td className="px-3 text-right text-app-success" style={{ paddingTop: 'var(--table-row-padding, 8px)', paddingBottom: 'var(--table-row-padding, 8px)' }}>{t('common.enabled')}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </SettingRow>
              </Section>

              <Section title={t('settings.updater_title')}>
                <SettingRow title={t('settings.updater_title')} description={t('settings.updater_desc')} stacked>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCheckForUpdates}
                      disabled={checkingUpdate || downloading}
                      className="h-8 px-3 inline-flex items-center gap-2 border border-app-border bg-app-surface text-xs text-app-text hover:bg-app-surface-hover disabled:opacity-50"
                    >
                      <RefreshCw size={13} className={checkingUpdate ? 'animate-spin' : ''} />
                      {t('settings.updater_btn_check')}
                    </button>
                    {updateAvailable && !downloading && (
                      <button
                        type="button"
                        onClick={handleInstallUpdate}
                        className="h-8 px-3 inline-flex items-center gap-2 border border-app-primary bg-app-primary text-xs font-medium text-white hover:bg-app-primary-hover"
                      >
                        <Download size={13} />
                        {t('settings.updater_btn_install')}
                      </button>
                    )}
                  </div>

                  {updateStatus && (
                    <div className={`mt-2 text-[11px] ${updateError ? 'text-app-danger' : 'text-app-muted'}`}>
                      {downloading ? (
                        <div className="space-y-1.5">
                          <div className="flex justify-between"><span>{updateStatus}</span><span>{progress}%</span></div>
                          <div className="h-1.5 border border-app-border bg-app-bg">
                            <div className="h-full bg-app-primary transition-[width]" style={{ width: `${progress}%` }} />
                          </div>
                        </div>
                      ) : updateStatus}
                    </div>
                  )}
                </SettingRow>
              </Section>
            </div>
          )}

          {activeTab === 'daemon' && (
            <div className="max-w-4xl space-y-4">
              <Section title={t('settings.daemon_title')}>
                <SettingRow title={t('settings.daemon_pipe')} description={t('settings.daemon_pipe_desc')}>
                  <div className="flex justify-end">
                    <span className={`inline-flex h-6 items-center border px-2 text-[10px] font-semibold uppercase tracking-wide ${
                      daemonConnected
                        ? 'border-app-success/40 bg-app-success/10 text-app-success'
                        : 'border-app-danger/40 bg-app-danger/10 text-app-danger'
                    }`}>
                      {daemonConnected ? t('status.connected') : t('status.disconnected')}
                    </span>
                  </div>
                </SettingRow>

                <SettingRow
                  title={t('settings.daemon_elevation')}
                  description={isElevated ? t('settings.daemon_elevation_active_desc') : t('settings.daemon_elevation_inactive_desc')}
                >
                  <div className="flex justify-end items-center gap-2">
                    {isElevated && (
                      <span className="inline-flex h-6 items-center border border-app-success/40 bg-app-success/10 px-2 text-[10px] font-semibold text-app-success">
                        {t('settings.daemon_elevation_admin')}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleRestartDaemon()}
                      className="h-8 px-3 inline-flex items-center gap-2 border border-app-border bg-app-surface text-xs text-app-text hover:bg-app-surface-hover"
                    >
                      <RefreshCw size={13} />
                      {t('settings.daemon_restart_label')}
                    </button>
                    {!isElevated && (
                      <button
                        type="button"
                        onClick={() => void handleRestartAsAdmin()}
                        className="h-8 px-3 inline-flex items-center gap-2 border border-app-primary bg-app-primary text-xs text-white hover:bg-app-primary-hover"
                      >
                        <Shield size={13} />
                        {t('settings.daemon_elevation_restart')}
                      </button>
                    )}
                  </div>
                </SettingRow>
              </Section>

              <Section title={t('settings.daemon_channels')}>
                <SettingRow title={t('settings.daemon_kb_hook')} description={t('settings.daemon_channels_desc')}>
                  <div className="flex justify-end"><Toggle checked={config.kbHookEnabled} onChange={() => void handleToggle('kbHookEnabled')} /></div>
                </SettingRow>
                <SettingRow title={t('settings.daemon_mouse_hook')}>
                  <div className="flex justify-end"><Toggle checked={config.mouseHookEnabled} onChange={() => void handleToggle('mouseHookEnabled')} /></div>
                </SettingRow>
              </Section>
            </div>
          )}

          {activeTab === 'logs' && (
            <div className="h-full min-h-[320px] max-w-5xl flex flex-col border border-app-border bg-app-bg">
              <div className="h-10 px-3 flex items-center gap-2 border-b border-app-border bg-app-surface/45 shrink-0">
                <span className="text-[11px] text-app-muted">{t('settings.logs_desc')}</span>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleOpenLogsFolder()}
                    className="h-7 px-2.5 inline-flex items-center gap-1.5 border border-app-border bg-app-surface text-[11px] text-app-text hover:bg-app-surface-hover"
                  >
                    <FolderOpen size={12} />
                    {t('settings.logs_open_folder')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setLogs([`[${new Date().toLocaleTimeString()}] [INFO] ${t('settings.logs_cleared')}`])}
                    className="h-7 px-2.5 border border-app-border bg-app-surface text-[11px] text-app-text hover:bg-app-surface-hover"
                  >
                    {t('settings.logs_clear')}
                  </button>
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-auto bg-[#0b0e12] p-3 font-mono text-[11px] leading-5 text-app-success">
                {logs.map((log, index) => <div key={`${index}-${log}`} className="whitespace-pre-wrap">{log}</div>)}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
