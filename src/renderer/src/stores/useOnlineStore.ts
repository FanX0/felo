import type { Session, User } from '@supabase/supabase-js'
import { create } from 'zustand'
import {
  beginOAuthSignIn,
  completeOAuthSignIn,
  getSupabase,
  isSupabaseConfigured
} from '../lib/supabase'
import type { OnlineProfile } from '../online/types'

interface OnlineState {
  configured: boolean
  initialized: boolean
  session: Session | null
  user: User | null
  profile: OnlineProfile | null
  authError: string | null
  isAuthenticating: boolean
  initialize: () => () => void
  refreshProfile: () => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  signInWithProvider: (provider: 'google' | 'discord') => Promise<void>
  clearAuthError: () => void
  signUp: (
    email: string,
    password: string,
    username: string,
    displayName: string
  ) => Promise<boolean>
  signOut: () => Promise<void>
  updateProfile: (
    values: Partial<Pick<OnlineProfile, 'username' | 'display_name' | 'bio' | 'avatar_url' | 'is_history_public'>> &
      Pick<OnlineProfile, 'username' | 'display_name'>
  ) => Promise<void>
}

async function fetchProfile(userId: string): Promise<OnlineProfile | null> {
  const { data, error } = await getSupabase()
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  return data as OnlineProfile | null
}

export const useOnlineStore = create<OnlineState>((set, get) => ({
  configured: isSupabaseConfigured,
  initialized: !isSupabaseConfigured,
  session: null,
  user: null,
  profile: null,
  authError: null,
  isAuthenticating: false,

  initialize: () => {
    if (!isSupabaseConfigured) return () => undefined
    const supabase = getSupabase()

    void supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user ?? null
      set({ session: data.session, user, initialized: true })
      if (user) {
        try {
          const profile = await fetchProfile(user.id)
          set({ profile })
        } catch (error) {
          console.error('Failed to load profile', error)
        }
      }
    })

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const user = session?.user ?? null
      set({ session, user, initialized: true, authError: null })
      if (user) {
        try {
          let profile = await fetchProfile(user.id)
          if (!profile) {
            await new Promise((resolve) => setTimeout(resolve, 500))
            profile = await fetchProfile(user.id)
          }
          set({ profile })
        } catch (error) {
          console.error('Failed to load profile on auth change', error)
        }
      } else {
        set({ profile: null })
      }
    })

    // Listen for OAuth deep link callback delivered from main process via preload
    const cleanupAuthCallback = window.api?.onAuthCallback?.((callbackUrl) => {
      void (async () => {
        try {
          set({ isAuthenticating: true, authError: null })
          await completeOAuthSignIn(callbackUrl)
        } catch (error) {
          const message = error instanceof Error ? error.message : 'OAuth sign in failed'
          console.error('[OAuth] Failed to complete sign in:', error)
          set({ authError: message })
        } finally {
          set({ isAuthenticating: false })
        }
      })()
    })

    // If running in browser web runtime, detect OAuth redirect tokens in URL
    if (typeof window !== 'undefined' && !window.electron) {
      const href = window.location.href
      const hasCode = href.includes('code=')
      const hasToken = href.includes('access_token=')
      const hasError = href.includes('error=') || href.includes('error_description=')
      if (hasCode || hasToken || hasError) {
        void (async () => {
          try {
            set({ isAuthenticating: true, authError: null })
            await completeOAuthSignIn(href)
            // Strip auth params from the browser address bar without reloading
            const cleanUrl =
              window.location.origin +
              window.location.pathname +
              (window.location.hash ? window.location.hash.split('?')[0] : '')
            window.history.replaceState({}, document.title, cleanUrl)
          } catch (error) {
            const message = error instanceof Error ? error.message : 'OAuth sign in failed'
            console.error('[OAuth Web] Failed to complete sign in:', error)
            set({ authError: message })
          } finally {
            set({ isAuthenticating: false })
          }
        })()
      }
    }

    return () => {
      subscription.unsubscribe()
      cleanupAuthCallback?.()
    }
  },

  refreshProfile: async () => {
    const user = get().user
    if (!user) return
    const profile = await fetchProfile(user.id)
    set({ profile })
  },

  signIn: async (email, password) => {
    set({ authError: null })
    const { error } = await getSupabase().auth.signInWithPassword({ email, password })
    if (error) {
      set({ authError: error.message })
      throw error
    }
  },

  signInWithProvider: async (provider) => {
    set({ authError: null })
    try {
      await beginOAuthSignIn(provider)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'OAuth sign in failed'
      set({ authError: message })
      throw error
    }
  },

  clearAuthError: () => set({ authError: null }),

  signUp: async (email, password, username, displayName) => {
    set({ authError: null })
    const supabase = getSupabase()
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username,
          display_name: displayName
        }
      }
    })

    if (error) {
      set({ authError: error.message })
      throw error
    }

    const createdUser = data.user
    if (createdUser) {
      const { error: profileError } = await supabase.from('profiles').upsert({
        id: createdUser.id,
        username,
        display_name: displayName
      })
      if (profileError) {
        console.warn('Initial profile creation deferred to backend trigger/policy', profileError)
      }
    }

    return Boolean(data.session)
  },

  signOut: async () => {
    set({ authError: null })
    const { error } = await getSupabase().auth.signOut()
    if (error) throw error
    set({ session: null, user: null, profile: null })
  },

  updateProfile: async (values) => {
    const user = get().user
    if (!user) throw new Error('Not authenticated')
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('profiles')
      .update(values)
      .eq('id', user.id)
      .select()
      .single()

    if (error) throw error
    set({ profile: data as OnlineProfile })
  }
}))
