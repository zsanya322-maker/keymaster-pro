/**
 * IPC Client — связь с Tauri backend
 *
 * Оборачивает tauri.invoke() для типизированных вызовов к Daemon.
 */

// TODO: Реализовать полный IPC клиент после реализации Named Pipe

/** Вызвать Tauri команду */
export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
  return tauriInvoke<T>(command, args)
}

/** Тестовый вызов */
export async function greet(name: string): Promise<string> {
  return invoke<string>('greet', { name })
}

/** Статус Daemon */
export async function getDaemonStatus(): Promise<{ connected: boolean; status: string }> {
  return invoke('daemon_status')
}