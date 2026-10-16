import { ipcMain } from 'electron'
import { getDb } from '../database'
import {
  validateWith,
  AllowedSettingsKeySchema,
  DownloadLocationSchema,
  SettingValueSchema
} from '../../shared/validators/ipcSchemas'

export function registerSettingsIpc(): void {
  // Settings: Get
  ipcMain.handle('settings:get', (_, key: string) => {
    if (typeof key !== 'string') return null
    const db = getDb()
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as any
    if (row) {
      try {
        return JSON.parse(row.value)
      } catch {
        return row.value
      }
    }
    return null
  })

  // Settings: Set (Whitelisted and validated keys only)
  ipcMain.handle('settings:set', (_, key: string, value: any) => {
    try {
      const validatedKey = validateWith(AllowedSettingsKeySchema, key)
      let serialized: string
      if (validatedKey === 'download.location') {
        const validatedLocation = validateWith(
          DownloadLocationSchema,
          typeof value === 'string' ? value : ''
        )
        serialized = JSON.stringify(validatedLocation)
      } else {
        const validatedValue = validateWith(SettingValueSchema, value)
        serialized = typeof validatedValue === 'string' ? validatedValue : JSON.stringify(validatedValue)
      }
      const db = getDb()
      db.prepare(
        `
        INSERT OR REPLACE INTO app_settings (key, value, updatedAt)
        VALUES (?, ?, strftime('%s', 'now'))
      `
      ).run(validatedKey, serialized)
    } catch (err) {
      console.warn(`[Settings] Rejected disallowed or invalid setting "${key}":`, err)
      throw new Error(`Invalid or protected setting key: ${key}`)
    }
  })
}
