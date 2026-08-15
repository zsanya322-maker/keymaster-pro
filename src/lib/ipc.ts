/**
 * Тонкая типизированная обёртка над Tauri invoke().
 *
 * Named Pipe живёт на Rust-стороне; frontend обращается либо к Tauri-командам,
 * либо к `ipc_call`, поэтому отдельный JS-клиент протокола здесь не нужен.
 */
export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
  return tauriInvoke<T>(command, args)
}
