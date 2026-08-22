import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

let client: SupabaseClient | null = null
const FELO_AUTH_STORAGE_KEY = 'felo-auth'

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  }

  if (!client) {
    const legacySession = localStorage.getItem('fanxmusic-auth')
    if (!localStorage.getItem(FELO_AUTH_STORAGE_KEY) && legacySession) {
      localStorage.setItem(FELO_AUTH_STORAGE_KEY, legacySession)
    }
    client = createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: FELO_AUTH_STORAGE_KEY
      }
    })
  }

  return client
}
