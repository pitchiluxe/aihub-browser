#!/usr/bin/env node
// Removes ELECTRON_RUN_AS_NODE before launching electron-vite.
// Claude Code sets this env var (it's an Electron app) — it disables
// Electron's module system in child processes, breaking require('electron').
delete process.env.ELECTRON_RUN_AS_NODE

const { spawn, execSync } = require('child_process')
const { join } = require('path')
const fs = require('fs')
const os = require('os')

const PID_FILE = join(os.homedir(), '.aihub-browser', 'dev.pid')

// ── Kill any previously launched dev instance ────────────────────────────────
function killPrevious() {
  try {
    if (fs.existsSync(PID_FILE)) {
      const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10)
      if (!isNaN(pid) && pid > 0) {
        try {
          if (process.platform === 'win32') {
            execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore', shell: true })
          } else {
            process.kill(pid, 'SIGKILL')
          }
          console.log(`[dev] Killed previous instance (PID ${pid})`)
        } catch {}
      }
      fs.unlinkSync(PID_FILE)
    }
  } catch {}
}

// ── Ensure dir exists ────────────────────────────────────────────────────────
function ensureDir() {
  const dir = join(os.homedir(), '.aihub-browser')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

killPrevious()
ensureDir()

// ── Spawn electron-vite dev (detached so it outlives this script) ─────────────
const child = spawn('npx', ['electron-vite', 'dev'], {
  stdio: 'inherit',
  env: process.env,
  shell: true,
  cwd: process.cwd(),
  detached: true,
})

// Save PID so next launch can kill this one
child.on('spawn', () => {
  try { fs.writeFileSync(PID_FILE, String(child.pid)) } catch {}
})

child.on('exit', () => {
  try { if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE) } catch {}
})

child.unref()

// Give it 10s to start, then exit — Electron keeps running detached
setTimeout(() => process.exit(0), 10000)
