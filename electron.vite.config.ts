import { resolve } from 'path'
import { readFileSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// ── Parse .env.local manually (no dotenv dep needed) ───────────────────────
function parseEnvFile(filePath: string): Record<string, string> {
  try {
    const content = readFileSync(filePath, 'utf-8')
    const out: Record<string, string> = {}
    for (const raw of content.split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq < 0) continue
      const k = line.slice(0, eq).trim()
      let v = line.slice(eq + 1).trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      if (k) out[k] = v
    }
    return out
  } catch { return {} }
}

const envLocal = parseEnvFile(resolve(process.cwd(), '.env.local'))
const envBase  = parseEnvFile(resolve(process.cwd(), '.env'))
// .env.local overrides .env
const env = { ...envBase, ...envLocal }

function e(key: string, fallback = ''): string {
  return env[key] || process.env[key] || fallback
}

// These are baked into the compiled main-process bundle at build time.
// The installed app therefore always has credentials even without .env.local.
const mainDefine: Record<string, string> = {
  'process.env.ANTHROPIC_AUTH_TOKEN':           JSON.stringify(e('ANTHROPIC_AUTH_TOKEN')),
  'process.env.ANTHROPIC_BASE_URL':             JSON.stringify(e('ANTHROPIC_BASE_URL', 'https://openrouter.ai/api')),
  'process.env.ANTHROPIC_MODEL':                JSON.stringify(e('ANTHROPIC_MODEL', 'qwen/qwen3-coder:free')),
  'process.env.NEXT_PUBLIC_OLLAMA_BASE_URL':    JSON.stringify(e('NEXT_PUBLIC_OLLAMA_BASE_URL', 'http://localhost:11434')),
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: mainDefine,
    resolve: {
      alias: { '@main': resolve('src/main') }
    },
    build: {
      rollupOptions: {
        output: { format: 'cjs' }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer':    resolve('src/renderer/src'),
        '@components':  resolve('src/renderer/src/components'),
        '@store':       resolve('src/renderer/src/store'),
        '@services':    resolve('src/renderer/src/services')
      }
    },
    plugins: [react()],
    css: {
      postcss: resolve('postcss.config.js')
    }
  }
})
