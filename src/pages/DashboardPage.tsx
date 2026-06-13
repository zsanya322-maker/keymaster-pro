import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../stores/app-store'
import { useProfileStore } from '../store/profileStore'
import { useRemapStore } from '../store/remapStore'
import { useMouseRemapStore } from '../store/mouseRemapStore'
import { useTextExpansionStore } from '../store/textExpansionStore'
import { useMacroStore } from '../store/macroStore'
import { invoke } from '../lib/ipc'
import { triggerToast } from '../lib/toast'

export function DashboardPage() {
  const { t } = useTranslation()
  const { daemonConnected, setDaemonConnected } = useAppStore()
  const { profiles, activeProfileId } = useProfileStore()
  
  const remapRules = useRemapStore((state) => state.rules)
  const mouseRules = useMouseRemapStore((state) => state.rules)
  const expansions = useTextExpansionStore((state) => state.expansions)
  const macros = useMacroStore((state) => state.macros)

  const [playgroundText, setPlaygroundText] = useState('')
  const [isSpawning, setIsSpawning] = useState(false)
  const diagnostics = useAppStore(state => state.diagnostics)

  // Получаем активный профиль
  const activeProfile = profiles.find(p => p.id === activeProfileId)

  const handleStartDaemon = async () => {
    setIsSpawning(true)
    try {
      await invoke('spawn_daemon')
      // Даем демону секунду запуститься и опрашиваем статус
      setTimeout(async () => {
        const status: any = await invoke('daemon_status')
        setDaemonConnected(!!(status && status.connected))
        setIsSpawning(false)
      }, 1500)
    } catch (e) {
      triggerToast('Не удалось запустить Демон', 'error')
      setIsSpawning(false)
    }
  }

  const handleStopDaemon = async () => {
    try {
      await invoke('stop_daemon')
      setDaemonConnected(false)
    } catch (e) {
      triggerToast('Не удалось остановить Демон', 'error')
    }
  }

  // Локальный обработчик автозамены для Playground
  // Имитирует логику текстовых расширений прямо в браузере для вау-эффекта
  const handlePlaygroundChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value
    setPlaygroundText(text)

    // Проверяем триггеры автотекста
    const activeExp = expansions.filter(te => te.profileId === activeProfileId && te.enabled)
    for (const exp of activeExp) {
      if (text.endsWith(exp.trigger)) {
        // Заменяем триггер на replacement
        const newText = text.slice(0, -exp.trigger.length) + exp.replacement
        setPlaygroundText(newText)
        break
      }
    }
  }

  return (
    <div className="space-y-8 max-w-6xl">
      {/* Welcome & Overview Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-app-surface-hover/80 to-app-surface/90 border border-app-border p-8">
        <div className="absolute top-0 right-0 w-[300px] h-full bg-gradient-to-l from-app-primary/10 to-transparent pointer-events-none" />
        <h1 className="text-3xl font-extrabold text-app-text tracking-tight mb-2">
          {t('dashboard.welcome', 'Добро пожаловать в KeyMaster Pro')}
        </h1>
        <p className="text-app-muted max-w-2xl text-sm leading-relaxed">
          {t('dashboard.description', 'Современная платформа автоматизации клавиатуры и мыши. Переназначайте клавиши, создавайте сложные макросы и вставляйте шаблоны текста мгновенно.')}
        </p>
      </div>

      {/* Grid of Core Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Connection & Control Widget */}
        <div className="bg-app-surface/60 backdrop-blur-md rounded-2xl border border-app-border p-6 flex flex-col justify-between min-h-[200px]">
          <div>
            <span className="text-[10px] font-bold text-app-muted uppercase tracking-wider block mb-3">
              {t('dashboard.daemon_status', 'Состояние Демона')}
            </span>
            <div className="flex items-center gap-3">
              <span className={`h-3 w-3 rounded-full ${daemonConnected ? 'bg-app-success pulse-success' : 'bg-app-danger pulse-danger'}`} />
              <span className="text-lg font-bold text-app-text">
                {daemonConnected ? t('dashboard.daemon_active', 'Фоновый процесс активен') : t('dashboard.daemon_stopped', 'Фоновый процесс остановлен')}
              </span>
            </div>
            <p className="text-app-muted text-xs mt-2">
              {t('dashboard.daemon_desc', 'Для работы хуков клавиатуры и мыши на уровне ОС бэкенд-демон должен быть запущен.')}
            </p>
          </div>

          <div className="mt-6">
            {daemonConnected ? (
              <button
                onClick={handleStopDaemon}
                className="w-full py-2.5 px-4 bg-app-danger/10 hover:bg-app-danger/20 border border-app-danger/30 hover:border-app-danger/60 text-app-danger rounded-xl text-sm font-semibold transition-all duration-200"
              >
                {t('dashboard.stop_daemon', 'Остановить Демон')}
              </button>
            ) : (
              <button
                onClick={handleStartDaemon}
                disabled={isSpawning}
                className="w-full py-2.5 px-4 bg-app-primary hover:bg-app-primary-hover text-white rounded-xl text-sm font-semibold shadow-lg shadow-app-primary/20 transition-all duration-200 disabled:opacity-50"
              >
                {isSpawning ? t('dashboard.spawning_daemon', 'Запуск демона...') : t('dashboard.start_daemon', 'Запустить Демон')}
              </button>
            )}
          </div>
        </div>

        {/* Profile Stats Widget */}
        <div className="bg-app-surface/60 backdrop-blur-md rounded-2xl border border-app-border p-6 flex flex-col justify-between min-h-[200px]">
          <div>
            <span className="text-[10px] font-bold text-app-muted uppercase tracking-wider block mb-3">
              {t('dashboard.active_profile', 'Активный Профиль')}
            </span>
            <h3 className="text-xl font-bold text-app-text mb-2">
              {activeProfile ? activeProfile.name : 'Default'}
            </h3>
            
            {/* Quick breakdown grid */}
            <div className="grid grid-cols-2 gap-4 mt-4 text-xs">
              <div className="bg-app-surface-hover/50 p-2.5 rounded-lg border border-app-border/60">
                <span className="text-app-muted block">{t('dashboard.keyboard', 'Клавиатура')}</span>
                <span className="text-sm font-bold text-app-text mt-1 block">
                  {remapRules.filter(r => r.profileId === activeProfileId).length} {t('dashboard.rules', 'правил')}
                </span>
              </div>
              <div className="bg-app-surface-hover/50 p-2.5 rounded-lg border border-app-border/60">
                <span className="text-app-muted block">{t('dashboard.mouse', 'Мышь')}</span>
                <span className="text-sm font-bold text-app-text mt-1 block">
                  {mouseRules.filter(r => r.profileId === activeProfileId).length} {t('dashboard.rules', 'правил')}
                </span>
              </div>
              <div className="bg-app-surface-hover/50 p-2.5 rounded-lg border border-app-border/60">
                <span className="text-app-muted block">{t('dashboard.text_expansions', 'Автотекст')}</span>
                <span className="text-sm font-bold text-app-text mt-1 block">
                  {expansions.filter(e => e.profileId === activeProfileId).length} {t('dashboard.rules', 'правил')}
                </span>
              </div>
              <div className="bg-app-surface-hover/50 p-2.5 rounded-lg border border-app-border/60">
                <span className="text-app-muted block">{t('dashboard.macros', 'Макросы')}</span>
                <span className="text-sm font-bold text-app-text mt-1 block">
                  {macros.filter(m => m.profileId === activeProfileId).length} {t('dashboard.macs_count', 'макросов')}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Performance Metrics Widget */}
        <div className="bg-app-surface/60 backdrop-blur-md rounded-2xl border border-app-border p-6 flex flex-col justify-between min-h-[200px]">
          <div>
            <span className="text-[10px] font-bold text-app-muted uppercase tracking-wider block mb-3">
              {t('dashboard.perf_metrics', 'Метрики Производительности')}
            </span>
            
            <div className="space-y-3 mt-2">
              <div className="flex justify-between items-center text-xs border-b border-app-border/60 pb-2">
                <span className="text-app-muted">{t('dashboard.latency', 'Задержка ввода (Input Latency)')}</span>
                <span className="font-mono text-app-text font-bold bg-app-surface-hover px-2 py-0.5 rounded border border-app-border">
                  {daemonConnected ? `${diagnostics.latency.toFixed(3)} ms` : '—'}
                </span>
              </div>
              <div className="flex justify-between items-center text-xs border-b border-app-border/60 pb-2">
                <span className="text-app-muted">{t('dashboard.keystrokes', 'Обработано нажатий (Keystrokes)')}</span>
                <span className="font-mono text-app-accent font-bold bg-app-accent/5 px-2 py-0.5 rounded border border-app-accent/20">
                  {daemonConnected ? diagnostics.keystrokes : '—'}
                </span>
              </div>
              <div className="flex justify-between items-center text-xs border-b border-app-border/60 pb-2">
                <span className="text-app-muted">{t('dashboard.cpu_load', 'Нагрузка на CPU (Daemon)')}</span>
                <span className="font-mono text-app-text font-bold">
                  {daemonConnected ? `${diagnostics.cpu.toFixed(2)}%` : '—'}
                </span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-app-muted">{t('dashboard.memory', 'Занято памяти (Memory)')}</span>
                <span className="font-mono text-app-text font-bold">
                  {daemonConnected ? `${diagnostics.ram.toFixed(1)} MB` : '—'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Testing Playground */}
      <div className="bg-app-surface/40 backdrop-blur-md rounded-2xl border border-app-border p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-app-text">{t('dashboard.playground', 'Интерактивный полигон (Playground)')}</h3>
            <p className="text-app-muted text-xs">
              {t('dashboard.playground_desc', 'Песочница для тестирования автотекста. Попробуйте набрать триггеры, например !email или !shg.')}
            </p>
          </div>
          <button
            onClick={() => setPlaygroundText('')}
            className="text-xs text-app-muted hover:text-app-text bg-app-surface-hover hover:bg-app-border px-3 py-1.5 rounded-lg border border-app-border transition-colors cursor-pointer"
          >
            {t('dashboard.clear', 'Очистить')}
          </button>
        </div>

        <textarea
          rows={4}
          value={playgroundText}
          onChange={handlePlaygroundChange}
          placeholder={t('dashboard.playground_placeholder', 'Начните писать здесь для проверки правил...')}
          className="w-full bg-app-bg/80 text-app-text border border-app-border rounded-xl p-4 focus:ring-2 focus:ring-app-primary focus:outline-none text-sm leading-relaxed placeholder-app-muted/50"
        />

        <div className="flex justify-between items-center mt-3 text-xs text-app-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-app-primary" />
            {t('dashboard.playground_footer', 'Автозамена происходит мгновенно при совпадении триггера.')}
          </span>
          <span className="font-mono">{t('dashboard.chars', 'Символов')}: {playgroundText.length}</span>
        </div>
      </div>
    </div>
  )
}