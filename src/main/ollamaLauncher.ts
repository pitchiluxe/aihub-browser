// How to start Ollama when it isn't running.
//
// The point is not just "make the API answer" but "make it visible": on
// Windows and macOS the desktop app runs the server AND puts the llama icon
// in the tray/menu bar, so the user can see Ollama working in the background
// and quit it from there. Only when no desktop app is installed do we fall
// back to a bare `ollama serve` (Linux, or a CLI-only install).
//
// Pure: the filesystem check is injected so the decision table is testable.

import { join } from 'path'

export interface LaunchCommand {
  command: string
  args: string[]
  /** 'tray' = desktop app with a visible icon; 'serve' = headless server. */
  kind: 'tray' | 'serve'
}

export function ollamaLaunchCommand(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  exists: (path: string) => boolean,
): LaunchCommand | null {
  if (platform === 'win32') {
    const roots = [env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs', 'Ollama'), env.ProgramFiles && join(env.ProgramFiles, 'Ollama')]
      .filter((p): p is string => !!p)
    for (const root of roots) {
      const tray = join(root, 'ollama app.exe')
      if (exists(tray)) return { command: tray, args: [], kind: 'tray' }
    }
    for (const root of roots) {
      const cli = join(root, 'ollama.exe')
      if (exists(cli)) return { command: cli, args: ['serve'], kind: 'serve' }
    }
    return null
  }
  if (platform === 'darwin') {
    for (const app of ['/Applications/Ollama.app', env.HOME && join(env.HOME, 'Applications', 'Ollama.app')]) {
      if (app && exists(app)) return { command: 'open', args: ['-g', '-a', app], kind: 'tray' }
    }
    for (const cli of ['/usr/local/bin/ollama', '/opt/homebrew/bin/ollama']) {
      if (exists(cli)) return { command: cli, args: ['serve'], kind: 'serve' }
    }
    return null
  }
  for (const cli of ['/usr/local/bin/ollama', '/usr/bin/ollama', env.HOME && join(env.HOME, '.local', 'bin', 'ollama')]) {
    if (cli && exists(cli)) return { command: cli, args: ['serve'], kind: 'serve' }
  }
  return null
}

/** One model Ollama currently holds in memory (from /api/ps). */
export interface LoadedModel {
  name: string
  /** Bytes in RAM+VRAM. */
  size: number
  /** Bytes on the GPU — 0 means it is running on the CPU. */
  sizeVram: number
  /** When Ollama will unload it if idle (ISO string). */
  expiresAt: string
}

export function parseLoadedModels(body: string): LoadedModel[] {
  try {
    const json = JSON.parse(body)
    return (Array.isArray(json?.models) ? json.models : [])
      .map((m: any) => ({
        name: String(m?.name || m?.model || ''),
        size: Number(m?.size) || 0,
        sizeVram: Number(m?.size_vram) || 0,
        expiresAt: String(m?.expires_at || ''),
      }))
      // Embedding models are loaded for semantic search, not chat — showing
      // "nomic-embed-text" as the running model would be misleading.
      .filter((m: LoadedModel) => m.name && !/embed/i.test(m.name))
  } catch {
    return []
  }
}
