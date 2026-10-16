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
    : `${window.location.origin}/`
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
  const cleanUrl = callbackUrl.trim().replace(/^["']|["']$/g, '')
  const url = new URL(cleanUrl)

  const searchParams = url.searchParams
  let hashParams: URLSearchParams | null = null
  if (url.hash) {
    const rawHash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash
    if (rawHash.includes('?')) {
      hashParams = new URLSearchParams(rawHash.split('?')[1])
    } else {
      hashParams = new URLSearchParams(rawHash)
    }
  }

  const getParam = (key: string): string | null => {
    return searchParams.get(key) || (hashParams ? hashParams.get(key) : null)
  }

  const providerError = getParam('error_description') || getParam('error')
  if (providerError) throw new Error(providerError)

  const code = getParam('code')
  const flowId = getParam('sb_flow_id') || getParam('flow_id')

  if (code) {
    const { error } = await getSupabase().auth.exchangeCodeForSession(
      code,
      flowId ? { flowId } : undefined
    )
    if (error) throw error
    return
  }

  const accessToken = getParam('access_token')
  const refreshToken = getParam('refresh_token')
  if (accessToken && refreshToken) {
    const { error } = await getSupabase().auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken
    })
    if (error) throw error
    return
  }

  throw new Error('The OAuth callback did not contain an authorization code or tokens.')
}
