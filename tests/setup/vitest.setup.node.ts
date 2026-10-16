import { vi } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs'

process.env.NODE_ENV = 'test'
process.env.FELO_MODE = 'public'

const tempUserData = path.join(os.tmpdir(), 'felo-test-userdata')
if (!fs.existsSync(tempUserData)) {
  fs.mkdirSync(tempUserData, { recursive: true })
}

vi.mock('electron', () => {
  return {
    app: {
      getPath: vi.fn((name: string) => {
        return tempUserData
      }),
      setName: vi.fn(),
      setPath: vi.fn(),
      isPackaged: false
    },
    BrowserWindow: {
      getAllWindows: vi.fn(() => [])
    },
    ipcMain: {
      handle: vi.fn(),
      on: vi.fn(),
      removeHandler: vi.fn()
    }
  }
})
