import { describe, it, expect } from 'vitest'
import { join } from 'path'
import { ollamaLaunchCommand, parseLoadedModels } from './ollamaLauncher'

const has = (...paths: string[]) => (p: string) => paths.includes(p)

describe('ollamaLaunchCommand', () => {
  const winEnv = { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', ProgramFiles: 'C:\\Program Files' }
  const winRoot = join(winEnv.LOCALAPPDATA, 'Programs', 'Ollama')

  it('prefers the Windows tray app so the llama icon is visible', () => {
    const cmd = ollamaLaunchCommand('win32', winEnv, has(join(winRoot, 'ollama app.exe'), join(winRoot, 'ollama.exe')))
    expect(cmd).toEqual({ command: join(winRoot, 'ollama app.exe'), args: [], kind: 'tray' })
  })

  it('falls back to a headless serve when only the CLI exists', () => {
    const cmd = ollamaLaunchCommand('win32', winEnv, has(join(winRoot, 'ollama.exe')))
    expect(cmd).toEqual({ command: join(winRoot, 'ollama.exe'), args: ['serve'], kind: 'serve' })
  })

  it('opens the macOS app in the background', () => {
    expect(ollamaLaunchCommand('darwin', {}, has('/Applications/Ollama.app')))
      .toEqual({ command: 'open', args: ['-g', '-a', '/Applications/Ollama.app'], kind: 'tray' })
  })

  it('serves on Linux and returns null when Ollama is not installed', () => {
    expect(ollamaLaunchCommand('linux', {}, has('/usr/bin/ollama'))?.args).toEqual(['serve'])
    expect(ollamaLaunchCommand('linux', {}, has())).toBeNull()
    expect(ollamaLaunchCommand('win32', winEnv, has())).toBeNull()
  })
})

describe('parseLoadedModels', () => {
  it('lists chat models in memory and hides embedding models', () => {
    const body = JSON.stringify({ models: [
      { name: 'nomic-embed-text:latest', size: 1, size_vram: 0 },
      { name: 'llama3.2:3b', size: 2561524365, size_vram: 0, expires_at: '2026-10-04T22:05:25-04:00' },
    ] })
    expect(parseLoadedModels(body)).toEqual([
      { name: 'llama3.2:3b', size: 2561524365, sizeVram: 0, expiresAt: '2026-10-04T22:05:25-04:00' },
    ])
  })
  it('survives garbage', () => {
    expect(parseLoadedModels('not json')).toEqual([])
    expect(parseLoadedModels('{}')).toEqual([])
  })
})
