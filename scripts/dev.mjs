#!/usr/bin/env node
import { execSync, spawn } from 'child_process'

const args = process.argv.slice(2)
const isPublic = args.includes('--public')
const isPrivate = args.includes('--private')
const cleanOnly = args.includes('--clean-only')

// Clean up any lingering background electron.exe processes (resolves Windows error 32 / sharing violation)
if (process.platform === 'win32') {
  try {
    const list = execSync('tasklist /FI "IMAGENAME eq electron.exe" /FO CSV /NH', { encoding: 'utf-8' })
    if (list && list.toLowerCase().includes('electron.exe')) {
      console.log('[Felo Dev] Cleaning up lingering background Electron process...')
      execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' })
    }
  } catch {}
}

if (cleanOnly) {
  console.log('[Felo Dev] Process cleanup complete.')
  process.exit(0)
}

if (isPublic) {
  process.env.FELO_MODE = 'public'
  console.log('\n=========================================')
  console.log('  Felo Dev: PUBLIC MODE (Open Source)')
  console.log('  Proprietary providers: FORCED DISABLED')
  console.log('=========================================\n')
} else if (isPrivate) {
  process.env.FELO_MODE = 'private'
  console.log('\n=========================================')
  console.log('  Felo Dev: PRIVATE MODE (Multi-Provider)')
  console.log('  Requires: Qobuz / Deezer / Soulseek')
  console.log('=========================================\n')
} else {
  console.log('\n=========================================')
  console.log('  Felo Dev: AUTO MODE')
  console.log('  (Detects providers if available)')
  console.log('=========================================\n')
}

const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const child = spawn(npxCmd, ['electron-vite', 'dev'], {
  stdio: 'inherit',
  env: process.env
})

child.on('exit', (code) => {
  process.exit(code ?? 0)
})
