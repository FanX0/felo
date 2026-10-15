#!/usr/bin/env node
import esbuild from 'esbuild'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..')

export async function compileProviders() {
  const entry = path.join(ROOT_DIR, 'src', 'main', 'providers', 'index.ts')
  const outDir = path.join(ROOT_DIR, 'resources', 'providers')
  const outFile = path.join(outDir, 'index.cjs')

  if (!fs.existsSync(entry)) {
    console.log('[Felo Providers] Notice: src/main/providers/index.ts not found. Skipping private compilation.')
    return false
  }

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true })
  }

  console.log('[Felo Providers] Compiling proprietary streaming stack (Qobuz / Deezer / Soulseek / Blowfish)...')
  await esbuild.build({
    entryPoints: [entry],
    outfile: outFile,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    external: ['electron', 'better-sqlite3'],
    sourcemap: false,
    minify: true
  })

  const stats = fs.statSync(outFile)
  console.log(`[Felo Providers] Bundle ready: resources/providers/index.cjs (${Math.round(stats.size / 1024)} KB)\n`)
  return true
}

// Execute if run directly
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isDirectRun) {
  compileProviders()
    .then((success) => {
      process.exit(success ? 0 : 1)
    })
    .catch((err) => {
      console.error('[Felo Providers] Compilation failed:', err)
      process.exit(1)
    })
}
