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
// The app's own version, baked in at build time. app.getVersion() reports the
// ELECTRON binary's version when the app runs unpackaged, so Settings, the
// manual footer and the assistant all claimed "34.5.8" in development — a
// version number that belongs to a different piece of software entirely.
const pkgVersion = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8')).version

const mainDefine: Record<string, string> = {
  'process.env.AIHUB_VERSION': JSON.stringify(pkgVersion),
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
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // Two preloads with different trust levels: `index` is the app UI's
        // IPC bridge; `webcontent` is attached to untrusted site content and
        // exposes nothing (see src/preload/webcontent.ts). They must build as
        // separate entry points, not one bundle.
        input: {
          index:      resolve('src/preload/index.ts'),
          webcontent: resolve('src/preload/webcontent.ts')
        },
        output: { format: 'cjs', entryFileNames: '[name].js' }
      }
    }
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
    },
    build: {
      sourcemap: false,
      rollupOptions: {
        // Split vendor libraries individually so the initial paint only pays for
        // what the homepage needs. Each listed chunk loads lazily when first used.
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined
            if (id.includes('framer-motion')) return 'vendor-motion'
            if (id.includes('react-markdown') || id.includes('remark-')) return 'vendor-markdown'
            if (id.includes('lucide-react')) return 'vendor-icons'
            if (id.includes('react') || id.includes('scheduler')) return 'vendor-react'
            if (id.includes('zustand') || id.includes('use-sync-external-store')) return 'vendor-state'
            if (id.includes('d3-') || id.includes('/d3/')) return 'vendor-d3'
            if (id.includes('@supabase')) return 'vendor-supabase'
            // LiveKit is 1MB+ — only used inside Community for voice/video, so
            // let it be its own chunk that loads on-demand with the page.
            if (id.includes('livekit')) return 'vendor-livekit'
            // Everything else: split each top-level package into its own chunk
            const pkg = id.split('node_modules/')[1]?.split('/')[0]?.split('/')[0]
            return `vendor-${pkg}`
          }
        }
      }
    }
  }
})
