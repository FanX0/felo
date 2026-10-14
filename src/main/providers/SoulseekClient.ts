import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { getDb } from '../database'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SlskClient } = require('soulseek-ts')

export const slsk = {
  connect: (options: any, callback: (error: Error | null, client?: any) => void) => {
    const client = new SlskClient({
      serverAddress: {
        host: options.host || 'server.slsknet.org',
        port: options.port || 2242
      },
      listenPort: options.incomingPort || 2234
    })

    client
      .login(options.user, options.pass, options.timeout || 30000)
      .then(() => {
        callback(null, {
          search: (request: any, searchCallback: (error: Error | null, results: any[]) => void) => {
            client
              .search(request.req, { timeout: request.timeout || 6000 })
              .then((responses: any[]) => {
                const results = responses.flatMap((response) =>
                  (response.files || []).map((file: any) => ({
                    user: response.username,
                    file: file.filename,
                    size: Number(file.size),
                    slots: Boolean(response.slotsFree),
                    speed: response.avgSpeed
                  }))
                )
                searchCallback(null, results)
              })
              .catch((error: Error) => searchCallback(error, []))
          },
          download: async (request: any, downloadCallback: (error: Error | null, data?: any) => void) => {
            let output: fs.WriteStream | null = null
            let settled = false
            const finish = (error: Error | null, data?: any) => {
              if (settled) return
              settled = true
              if (error && output) {
                try {
                  output.destroy()
                  if (fs.existsSync(request.path)) fs.unlinkSync(request.path)
                } catch {}
              }
              downloadCallback(error, data)
            }

            if (request.signal?.aborted) {
              finish(new Error('Download cancelled'))
              return
            }

            try {
              const download = await client.download(request.file.user, request.file.file)

              if (request.signal?.aborted) {
                finish(new Error('Download cancelled'))
                return
              }

              const onAbort = () => {
                try {
                  download.stream?.destroy()
                } catch {}
                finish(new Error('Download cancelled'))
              }
              request.signal?.addEventListener('abort', onAbort, { once: true })

              download.events.on('status', (status: string, data: any) => {
                request.onProgress?.(status, data)
              })
              download.events.on('progress', (data: any) => {
                request.onProgress?.('downloading', data)
              })

              fs.mkdirSync(path.dirname(request.path), { recursive: true })
              output = fs.createWriteStream(request.path)
              download.stream.pipe(output)

              output.once('finish', () => {
                request.signal?.removeEventListener('abort', onAbort)
                finish(null, { path: request.path })
              })
              output.once('error', (error: Error) => {
                request.signal?.removeEventListener('abort', onAbort)
                finish(error)
              })
              download.stream.once('error', (error: Error) => {
                request.signal?.removeEventListener('abort', onAbort)
                finish(error)
              })
            } catch (error) {
              finish(error as Error)
            }
          },
          destroy: () => client.destroy()
        })
      })
      .catch((error: Error) => {
        client.destroy()
        callback(error)
      })
  }
}

const SOULSEEK_CREDENTIALS_SETTING = 'download.soulseekCredentials'

export type SoulseekCredentials = { user: string; pass: string }

export function getSoulseekCredentials(accounts: any): SoulseekCredentials {
  const user = accounts?.soulseekUser?.trim()
  const pass = accounts?.soulseekPassword?.trim()

  if (user || pass) {
    if (!user || !pass) {
      throw new Error('Enter both your Soulseek username and password.')
    }
    return { user, pass }
  }

  const db = getDb()
  const row = db
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get(SOULSEEK_CREDENTIALS_SETTING) as { value?: string } | undefined

  if (row?.value) {
    try {
      const saved = JSON.parse(row.value) as Partial<SoulseekCredentials>
      if (saved.user && saved.pass) return { user: saved.user, pass: saved.pass }
    } catch {}
  }

  const credentials = {
    user: `felo_${crypto.randomBytes(6).toString('hex')}`,
    pass: crypto.randomBytes(12).toString('base64url')
  }
  db.prepare(
    `INSERT OR REPLACE INTO app_settings (key, value, updatedAt)
     VALUES (?, ?, strftime('%s', 'now'))`
  ).run(SOULSEEK_CREDENTIALS_SETTING, JSON.stringify(credentials))

  return credentials
}

export function formatSoulseekError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || '')
  if (/login failed/i.test(raw)) {
    return 'Soulseek login failed. Please verify your Soulseek credentials in Settings.'
  }
  if (/timeout/i.test(raw)) {
    return 'Soulseek request timed out. The peer network or server may be slow.'
  }
  return raw || 'Soulseek error occurred'
}
