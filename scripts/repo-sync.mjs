#!/usr/bin/env node
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..')

function run(cmd, options = {}) {
  return execSync(cmd, { cwd: ROOT_DIR, stdio: 'inherit', ...options })
}

function runCapture(cmd, options = {}) {
  try {
    return execSync(cmd, { cwd: ROOT_DIR, encoding: 'utf-8', ...options }).trim()
  } catch (err) {
    return err.stdout?.toString() || ''
  }
}

// Base64-obfuscated scanner patterns to prevent publishing sensitive plain-text keys in public scripts
const getForbiddenSecrets = () => {
  const encoded = [
    'ZzRlbDU4d2MwenZmOW5hMQ==', // Blowfish key
    'YmU2NzU5ZDdjYzRlOGNmYzJmMGY4MWQxZWI5NmRiNmY=', // Qobuz app secret
    'NzEyMTA4NzA5' // Qobuz app id
  ]
  return encoded.map((b64) => Buffer.from(b64, 'base64').toString('utf-8'))
}

function getCurrentBranch() {
  return runCapture('git rev-parse --abbrev-ref HEAD')
}

function printStatus() {
  console.log('\n=== Felo Dual-Repository Sync Status ===')
  const branch = getCurrentBranch()
  console.log(`Current Branch: ${branch}`)

  const remotes = runCapture('git remote -v')
  console.log('\nRemotes:')
  console.log(remotes || 'No remotes configured!')

  const hasProviders = fs.existsSync(path.join(ROOT_DIR, 'src', 'main', 'providers'))
  const hasWorktree = fs.existsSync(path.join(ROOT_DIR, '..', 'felo-private', 'src', 'main', 'providers'))
  console.log(`\nLocal Providers Folder (src/main/providers/): ${hasProviders ? 'PRESENT (mounted)' : 'ABSENT (clean)'}`)
  console.log(`Linked Worktree Providers (../felo-private/): ${hasWorktree ? 'PRESENT (worktree ready)' : 'ABSENT'}`)

  const status = runCapture('git status --short')
  console.log('\nWorking Directory Changes:')
  console.log(status || '(Clean - no changes)')
  console.log('=========================================\n')
}

function syncPrivate(message) {
  console.log('\n[Felo Sync] === Backing up to PRIVATE Repository (felo-private) ===')
  const branch = getCurrentBranch()

  if (branch !== 'backup-full') {
    console.log(`Switching from '${branch}' to 'backup-full'...`)
    run('git checkout backup-full')
  }

  // Ensure providers and private README are tracked on private backup branch
  if (fs.existsSync(path.join(ROOT_DIR, 'src', 'main', 'providers'))) {
    console.log('Adding src/main/providers/ to private backup...')
    run('git add -f src/main/providers')
  }
  if (fs.existsSync(path.join(ROOT_DIR, 'README.private.md'))) {
    console.log('Adding README.private.md to private backup...')
    run('git add -f README.private.md')
  }

  // Stage general project changes
  run('git add .')

  const status = runCapture('git status --porcelain')
  if (status) {
    const commitMsg = message || `chore(backup): update private backup - ${new Date().toISOString().slice(0, 10)}`
    console.log(`Committing: "${commitMsg}"`)
    run(`git commit -m "${commitMsg}"`)
  } else {
    console.log('No new changes to commit.')
  }

  console.log('Pushing to private repository (FanX0/felo-private:backup-full)...')
  run('git push private backup-full')
  console.log(' Private backup complete!\n')
}

function syncPublic(message) {
  console.log('\n[Felo Sync] === Publishing to PUBLIC Repository (felo) ===')
  const branch = getCurrentBranch()

  if (branch !== 'clean-main') {
    console.log(`Switching from '${branch}' to 'clean-main'...`)
    run('git checkout clean-main')
  }

  // Pull latest updates from backup-full into clean-main working tree, explicitly excluding proprietary paths
  console.log('Syncing clean codebase from backup-full...')
  run('git checkout backup-full -- . ":!src/main/providers" ":!resources/providers" ":!README.private.md"')

  // Purge any proprietary files from working tree and staging
  const forbiddenPaths = ['src/main/providers', 'resources/providers', 'README.private.md']
  for (const relPath of forbiddenPaths) {
    const fullPath = path.join(ROOT_DIR, relPath)
    if (fs.existsSync(fullPath)) {
      console.log(`Purging ${relPath} from public branch...`)
      fs.rmSync(fullPath, { recursive: true, force: true })
    }
    runCapture(`git rm -rf --cached --ignore-unmatch "${relPath}"`)
    runCapture(`git reset HEAD -- "${relPath}"`)
  }

  // 1. Pre-flight Security Audit
  console.log('\n[Security Audit] Checking staged and tracked files...')
  const stagedFiles = runCapture('git diff --name-only --cached')
  const trackedFiles = runCapture('git ls-files')

  if (
    stagedFiles.includes('src/main/providers') ||
    trackedFiles.includes('src/main/providers') ||
    stagedFiles.includes('resources/providers') ||
    trackedFiles.includes('resources/providers') ||
    stagedFiles.includes('README.private.md') ||
    trackedFiles.includes('README.private.md')
  ) {
    console.error('\n❌ CRITICAL SECURITY ERROR: Private assets (src/main/providers/, resources/providers/ or README.private.md) tracked or staged on public branch!')
    console.error('Aborting push to public repository to prevent secret leak.')
    process.exit(1)
  }

  // 2. Secret Pattern Scanning
  console.log('[Security Audit] Scanning working tree for leaked secret keys...')
  const diffContent =
    runCapture('git diff -- . ":(exclude)scripts/build-app.mjs" ":(exclude)scripts/repo-sync.mjs"') +
    '\n' +
    runCapture('git diff --cached -- . ":(exclude)scripts/build-app.mjs" ":(exclude)scripts/repo-sync.mjs"')
  for (const secret of getForbiddenSecrets()) {
    if (diffContent.includes(secret)) {
      console.error(`\n❌ CRITICAL SECURITY ERROR: Proprietary secret pattern detected in git diff!`)
      console.error('Aborting push to public repository.')
      process.exit(1)
    }
  }
  console.log('✓ Security Audit Passed: 0 leaked secrets found.')

  // 3. Stage clean files
  run('git add .')

  const status = runCapture('git status --porcelain')
  if (status) {
    const commitMsg = message || `feat/fix: open-source player updates - ${new Date().toISOString().slice(0, 10)}`
    console.log(`Committing: "${commitMsg}"`)
    run(`git commit -m "${commitMsg}"`)
  } else {
    console.log('No new changes to commit.')
  }

  // 4. Push to public
  console.log('\nPushing to public repository (FanX0/felo:main)...')
  run('git push public clean-main:main')
  console.log('✓ Open-source public release pushed successfully!\n')

  // 5. Restore back to backup-full
  console.log('Returning to private development branch (backup-full)...')
  run('git checkout backup-full')
}

const [action, ...msgParts] = process.argv.slice(2)
const message = msgParts.join(' ').trim()

switch (action) {
  case 'private':
    syncPrivate(message)
    break
  case 'public':
    syncPublic(message)
    break
  case 'status':
    printStatus()
    break
  default:
    console.log(`
Usage:
  node scripts/repo-sync.mjs private [commit-message]  -> Backup everything to FanX0/felo-private
  node scripts/repo-sync.mjs public [commit-message]   -> Run audit and push clean player to FanX0/felo
  node scripts/repo-sync.mjs status                    -> Inspect current branch and sync status
`)
}
