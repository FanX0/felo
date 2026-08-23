import { createClient, type Provider, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
const isElectronRuntime = typeof window !== 'undefined' && Boolean(window.electron)

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

let client: SupabaseClient | null = null
const FELO_AUTH_STORAGE_KEY = 'felo-auth'
export const FELO_OAUTH_CALLBACK_URL = 'felo://auth/callback'

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
        detectSessionInUrl: !isElectronRuntime,
        flowType: 'pkce',
        storageKey: FELO_AUTH_STORAGE_KEY
      }
    })
  }

  return client
}

export async function beginOAuthSignIn(
  provider: Extract<Provider, 'google' | 'discord'>
): Promise<void> {
  const redirectTo = isElectronRuntime
    ? FELO_OAUTH_CALLBACK_URL
    : `${window.location.origin}/#/account`
  const { data, error } = await getSupabase().auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: isElectronRuntime
    }
  })
  if (error) throw error
  if (isElectronRuntime) {
    if (!data.url) throw new Error(`Supabase did not return a ${provider} sign-in URL.`)
    await window.api.openExternal(data.url)
  }
}

export async function completeOAuthSignIn(callbackUrl: string): Promise<void> {
  const url = new URL(callbackUrl)
  const providerError = url.searchParams.get('error_description') || url.searchParams.get('error')
  if (providerError) throw new Error(providerError)

  const code = url.searchParams.get('code')
  if (!code) throw new Error('The OAuth callback did not contain an authorization code.')

  const { error } = await getSupabase().auth.exchangeCodeForSession(code)
  if (error) throw error
}
