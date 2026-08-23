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
    values: Pick<OnlineProfile, 'username' | 'display_name' | 'bio' | 'avatar_url'>
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

  initialize: () => {
    if (!isSupabaseConfigured) return () => undefined
    const supabase = getSupabase()

    void supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user ?? null
      set({ session: data.session, user, initialized: true })
      if (user) {
        try {
          set({ profile: await fetchProfile(user.id) })
        } catch (error) {
          console.error('Failed to load online profile:', error)
        }
      }
    })

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null
      set({ session, user, profile: user ? get().profile : null, initialized: true })
      if (user) void get().refreshProfile()
    })

    const removeAuthCallbackListener = window.api.onAuthCallback((callbackUrl) => {
      set({ authError: null })
      void completeOAuthSignIn(callbackUrl).catch((error: unknown) => {
        set({
          authError: error instanceof Error ? error.message : 'Unable to complete social sign-in.'
        })
      })
    })

    return () => {
      data.subscription.unsubscribe()
      removeAuthCallbackListener()
    }
  },

  refreshProfile: async () => {
    const user = get().user
    if (!user) return set({ profile: null })
    set({ profile: await fetchProfile(user.id) })
  },

  signIn: async (email, password) => {
    set({ authError: null })
    const { error } = await getSupabase().auth.signInWithPassword({ email, password })
    if (error) throw error
  },

  signInWithProvider: async (provider) => {
    set({ authError: null })
    await beginOAuthSignIn(provider)
  },

  clearAuthError: () => set({ authError: null }),

  signUp: async (email, password, username, displayName) => {
    const { data, error } = await getSupabase().auth.signUp({
      email,
      password,
      options: { data: { username: username.toLowerCase(), display_name: displayName } }
    })
    if (error) throw error
    return Boolean(data.session)
  },

  signOut: async () => {
    const { error } = await getSupabase().auth.signOut()
    if (error) throw error
    set({ session: null, user: null, profile: null })
  },

  updateProfile: async (values) => {
    const user = get().user
    if (!user) throw new Error('Sign in to update your profile.')
    const { error } = await getSupabase()
      .from('profiles')
      .update({
        ...values,
        username: values.username.toLowerCase(),
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id)
    if (error) throw error
    await get().refreshProfile()
  }
}))
