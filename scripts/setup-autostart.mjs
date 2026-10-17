#!/usr/bin/env node
import fs from 'fs'
import path from 'path'
import { spawn, execSync } from 'child_process'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..')

dotenv.config({ path: path.join(ROOT_DIR, '.env') })
dotenv.config({ path: path.join(ROOT_DIR, '.env.local'), override: true })

const isRemove = process.argv.includes('--remove') || process.argv.includes('remove')

if (process.platform !== 'win32') {
  console.log('ℹ️ Automatic Windows startup is only supported on Windows.')
  console.log('On Linux/macOS, use: npx pm2 start scripts/universal-discord-bot.mjs --name felo-discord-bot && npx pm2 startup')
  process.exit(0)
}

const startupFolder = path.join(
  process.env.APPDATA || '',
  'Microsoft',
  'Windows',
  'Start Menu',
  'Programs',
  'Startup'
)

const vbsFile = path.join(startupFolder, 'FeloDiscordBot.vbs')

function stopBot() {
  try {
    const psScript = "Get-CimInstance Win32_Process -Filter \\\"Name = 'node.exe'\\\" | Where-Object { $_.CommandLine -like '*universal-discord-bot*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
    execSync(`powershell.exe -NoProfile -Command "${psScript}"`, { stdio: 'ignore' })
  } catch (_) {}
}

if (isRemove) {
  stopBot()
  if (fs.existsSync(vbsFile)) {
    fs.unlinkSync(vbsFile)
    console.log('✅ Removed Felo Discord Bot from Windows Startup.')
  } else {
    console.log('ℹ️ Felo Discord Bot was not installed in Windows Startup.')
  }
  process.exit(0)
}

if (!fs.existsSync(startupFolder)) {
  console.error('❌ Could not locate Windows Startup folder at:', startupFolder)
  process.exit(1)
}

// Ensure token is configured
const token = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN
if (!token) {
  console.error('❌ DISCORD_BOT_TOKEN is missing in your .env or .env.local file.')
  console.error('Please add: DISCORD_BOT_TOKEN=your_token_here to .env before enabling autostart.')
  process.exit(1)
}

const logFile = path.join(ROOT_DIR, 'bot.log')

// Create silent VBS launcher (runs with window style 0 = completely hidden in background)
const vbsContent = [
  'Set WshShell = CreateObject("WScript.Shell")',
  `WshShell.CurrentDirectory = "${ROOT_DIR}"`,
  'WshShell.Run "cmd.exe /c node scripts\\universal-discord-bot.mjs > bot.log 2>&1", 0, False',
  ''
].join('\r\n')

fs.writeFileSync(vbsFile, vbsContent, 'utf-8')
console.log('✅ Created Windows background startup script at:')
console.log(`   ${vbsFile}`)

// Stop any previous instance and launch now
stopBot()

const child = spawn('wscript.exe', [vbsFile], {
  detached: true,
  stdio: 'ignore',
  cwd: ROOT_DIR
})
child.unref()

console.log('\n🚀 Felo Discord Bot is now running silently in the background!')
console.log('🔄 It will automatically launch every time Windows starts up.')
console.log('💡 To stop or uninstall later, run: npm run bot:autostart:remove\n')
