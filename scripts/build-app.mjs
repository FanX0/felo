#!/usr/bin/env node
import { execSync, spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { compileProviders } from './compile-providers.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..')

const args = process.argv.slice(2)
const isPublic = args.includes('--public')
const isPrivate = args.includes('--private')
const isAll = args.includes('--all') || (!isPublic && !isPrivate)
const isUnpack = args.includes('--unpack') || args.includes('--dir')
const isMac = args.includes('--mac')
const isLinux = args.includes('--linux')
const isWin = args.includes('--win') || (!isMac && !isLinux && process.platform === 'win32')
const skipTypecheck = args.includes('--skip-typecheck')

const FORBIDDEN_SECRETS = [
  'g4el58wc0zvf9na1', // Deezer Blowfish decryption key
  'be6759d7cc4e8cfc2f0f81d1eb96db6f', // Qobuz app secret
  '712108709' // Qobuz app id
]

function run(cmd, env = {}) {
  return execSync(cmd, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: { ...process.env, ...env }
  })
}

function runCapture(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT_DIR, encoding: 'utf-8' }).trim()
  } catch (err) {
    return err.stdout?.toString() || ''
  }
}

function cleanLingeringProcesses() {
  if (process.platform === 'win32') {
    try {
      const list = execSync('tasklist /FI "IMAGENAME eq electron.exe" /FO CSV /NH', { encoding: 'utf-8' })
      if (list && list.toLowerCase().includes('electron.exe')) {
        console.log('[Felo Build] Terminating lingering background Electron processes...')
        execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' })
      }
    } catch {}
  }
}

function getBuilderTargetFlags() {
  const flags = []
  if (isUnpack) {
    flags.push('--dir')
  } else {
    if (isWin) flags.push('--win')
    if (isMac) flags.push('--mac')
    if (isLinux) flags.push('--linux')
  }
  return flags.join(' ')
}

function runSecurityAudit() {
  console.log('[Security Audit] Checking for secret leaks in public release...')
  const diffContent = runCapture('git diff') + '\n' + runCapture('git diff --cached')
  for (const secret of FORBIDDEN_SECRETS) {
    if (diffContent.includes(secret)) {
      console.error(`\n❌ CRITICAL SECURITY ERROR: Secret pattern "${secret}" detected in git diff!`)
      console.error('Aborting public build to prevent secret leaks.')
      process.exit(1)
    }
  }
  console.log('✓ Security Audit Passed: 0 leaked secrets found.')
}

async function buildPublic() {
  console.log('\n============================================================')
  console.log('  Building FELO PUBLIC App Setup (Open Source Edition)')
  console.log('  Proprietary providers: FORCED DISABLED & EXCLUDED')
  console.log('============================================================\n')

  // 1. Audit
  runSecurityAudit()

  // 2. Remove resources/providers if present to prevent any leakage
  const providersDir = path.join(ROOT_DIR, 'resources', 'providers')
  if (fs.existsSync(providersDir)) {
    console.log('[Felo Build] Purging resources/providers from public build directory...')
    fs.rmSync(providersDir, { recursive: true, force: true })
  }

  // 3. Typecheck
  if (!skipTypecheck) {
    console.log('\n[Felo Build] Running TypeScript pre-flight checks...')
    run('npm run typecheck')
  }

  // 4. Build web & main bundles with FELO_MODE=public
  console.log('\n[Felo Build] Compiling Electron + Renderer bundles (FELO_MODE=public)...')
  run('npx electron-vite build', { FELO_MODE: 'public' })

  // 5. Package with electron-builder
  const targetFlags = getBuilderTargetFlags()
  console.log(`\n[Felo Build] Packaging Public App Setup via electron-builder (${targetFlags || 'default'})...`)
  run(`npx electron-builder --config electron-builder.public.yml ${targetFlags}`, { FELO_MODE: 'public' })

  console.log('\n✓ Public App Setup built successfully!')
}

async function buildPrivate() {
  console.log('\n============================================================')
  console.log('  Building FELO PRIVATE App Setup (Multi-Provider Edition)')
  console.log('  Includes: Qobuz 24-bit Hi-Res | Deezer FLAC | Soulseek P2P')
  console.log('============================================================\n')

  // 1. Verify and compile providers
  const compiled = await compileProviders()
  if (!compiled) {
    console.error('\n❌ Build Error: Proprietary providers (src/main/providers/index.ts) not found!')
    console.error('Make sure you are on the "backup-full" branch or have providers linked.')
    process.exit(1)
  }

  // 2. Typecheck
  if (!skipTypecheck) {
    console.log('\n[Felo Build] Running TypeScript pre-flight checks...')
    run('npm run typecheck')
  }

  // 3. Build web & main bundles with FELO_MODE=private
  console.log('\n[Felo Build] Compiling Electron + Renderer bundles (FELO_MODE=private)...')
  run('npx electron-vite build', { FELO_MODE: 'private' })

  // 4. Package with electron-builder
  const targetFlags = getBuilderTargetFlags()
  console.log(`\n[Felo Build] Packaging Private App Setup via electron-builder (${targetFlags || 'default'})...`)
  run(`npx electron-builder --config electron-builder.private.yml ${targetFlags}`, { FELO_MODE: 'private' })

  console.log('\n✓ Private App Setup built successfully!')
}

async function main() {
  cleanLingeringProcesses()

  const startTime = Date.now()

  if (isAll) {
    console.log('[Felo Build Orchestrator] Building BOTH Public and Private App Setups...\n')
    await buildPublic()
    await buildPrivate()
  } else if (isPublic) {
    await buildPublic()
  } else if (isPrivate) {
    await buildPrivate()
  }

  const durationSec = Math.round((Date.now() - startTime) / 1000)

  // Output generated artifacts summary
  console.log('\n============================================================')
  console.log(`  Felo App Setup Build Complete (${durationSec}s)`)
  console.log('============================================================')

  const distDir = path.join(ROOT_DIR, 'dist')
  if (fs.existsSync(distDir)) {
    const files = fs.readdirSync(distDir)
    const setups = files.filter((f) => f.endsWith('.exe') || f.endsWith('.dmg') || f.endsWith('.AppImage'))
    console.log('\nGenerated App Setup Installers:')
    for (const setup of setups) {
      const stat = fs.statSync(path.join(distDir, setup))
      const mb = (stat.size / (1024 * 1024)).toFixed(2)
      console.log(`  • ${setup} (${mb} MB)`)
    }
  }
  console.log('============================================================\n')
}

main().catch((err) => {
  console.error('[Felo Build] Fatal error:', err)
  process.exit(1)
})
