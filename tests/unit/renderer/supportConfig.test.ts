import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SUPPORT_CONFIG,
  FELO_APP_SETUP_URL,
  FELO_GITHUB_RELEASES_URL,
  FELO_ANDROID_APK_URL,
  FELO_IOS_IPA_URL,
  buildSaweriaUrl,
  buildTrakteerUrl,
  buildGithubRepoUrl,
  buildSolscanUrl,
  buildDiscordInviteUrl,
  FELO_DISCORD_BOT_INVITE_URL,
  buildDiscordBotInviteUrl
} from '../../../src/renderer/src/lib/supportConfig'

describe('supportConfig URL builders', () => {
  it('exports official app download and GitHub releases URLs', () => {
    expect(FELO_APP_SETUP_URL).toBe('https://github.com/FanX0/felo/releases/latest/download/Felo-Setup.exe')
    expect(FELO_GITHUB_RELEASES_URL).toBe('https://github.com/FanX0/felo/releases')
    expect(FELO_ANDROID_APK_URL).toBe('https://github.com/FanX0/felo/releases/latest/download/Felo.apk')
    expect(FELO_IOS_IPA_URL).toBe('https://github.com/FanX0/felo/releases/latest/download/Felo.ipa')
  })

  it('builds discord invite url correctly', () => {
    expect(buildDiscordInviteUrl()).toBe('https://discord.gg/K4We3eBqQ')
    expect(buildDiscordInviteUrl('')).toBe('https://discord.gg/K4We3eBqQ')
    expect(buildDiscordInviteUrl('https://discord.gg/K4We3eBqQ')).toBe('https://discord.gg/K4We3eBqQ')
    expect(buildDiscordInviteUrl('K4We3eBqQ')).toBe('https://discord.gg/K4We3eBqQ')
    expect(buildDiscordInviteUrl('discord.gg/customRoom')).toBe('https://discord.gg/customRoom')
    expect(DEFAULT_SUPPORT_CONFIG.discordInvite).toBe('https://discord.gg/K4We3eBqQ')
  })

  it('builds default saweria and trakteer URLs', () => {
    expect(buildSaweriaUrl()).toBe('https://saweria.co/feloapp')
    expect(buildTrakteerUrl()).toBe('https://trakteer.id/feloapp/tip')
    expect(buildGithubRepoUrl()).toBe('https://github.com/FanX0/felo')
    expect(buildSolscanUrl()).toBe('https://solscan.io')
  })

  it('builds discord bot invite url correctly', () => {
    expect(FELO_DISCORD_BOT_INVITE_URL).toContain('client_id=1559904111883714691')
    expect(FELO_DISCORD_BOT_INVITE_URL).toContain('scope=bot%20applications.commands')
    expect(buildDiscordBotInviteUrl()).toBe(FELO_DISCORD_BOT_INVITE_URL)
    expect(buildDiscordBotInviteUrl('123456')).toContain('client_id=123456')
  })
})
