import { ipcMain } from 'electron'
import { recordPlayEvent, getListeningHistory } from '../database'
import { validateWith, PlayRecordSchema } from '../../shared/validators/ipcSchemas'

export function registerPlaybackIpc(): void {
  // Playback Ledger & History (Industry Standard Scrobble)
  ipcMain.handle('playback:recordPlay', async (_, payload: any) => {
    try {
      const validated = validateWith(PlayRecordSchema, payload)
      return recordPlayEvent(validated)
    } catch (err) {
      console.warn('[Playback] Blocked invalid playback record payload:', err)
      return null
    }
  })

  ipcMain.handle('playback:getListeningHistory', async (_, limit?: number) => {
    const safeLimit =
      typeof limit === 'number' && Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 50
    return getListeningHistory(safeLimit)
  })
}
