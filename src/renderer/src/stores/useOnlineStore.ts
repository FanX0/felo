import type { Session, User } from '@supabase/supabase-js'
import { create } from 'zustand'
import {
  beginOAuthSignIn,
  completeOAuthSignIn,
  getSupabase,
  isSupabaseConfigured
} from '../lib/supabase'
import { uploadAvatarImage, deleteAvatarImage } from '../lib/avatar'
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
    values: Partial<
      Pick<
        OnlineProfile,
        'username' | 'display_name' | 'bio' | 'avatar_url' | 'is_history_public' | 'updated_at'
      >
    >
  ) => Promise<void>
  uploadAvatar: (file: File) => Promise<string>
  removeAvatar: () => Promise<void>
}

async function fetchProfile(
  userId: string,
  currentUser?: User | null
): Promise<OnlineProfile | null> {
  const { data, error } = await getSupabase()
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const profile = data as OnlineProfile

  // Fallback to OAuth metadata avatar if profile avatar_url is missing
  if (!profile.avatar_url && currentUser && currentUser.id === userId) {
    const metaAvatar = (currentUser.user_metadata?.avatar_url ||
      currentUser.user_metadata?.picture ||
      null) as string | null
    if (metaAvatar) {
      profile.avatar_url = metaAvatar
      void Promise.resolve(
        getSupabase().from('profiles').update({ avatar_url: metaAvatar }).eq('id', userId)
      ).catch((e) => console.warn('Deferred avatar backfill skipped:', e))
    }
  }

  return profile
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
          const profile = await fetchProfile(user.id, user)
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
          let profile = await fetchProfile(user.id, user)
          if (!profile) {
            await new Promise((resolve) => setTimeout(resolve, 500))
            profile = await fetchProfile(user.id, user)
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
    const profile = await fetchProfile(user.id, user)
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
    const currentProfile = get().profile
    if (!user) throw new Error('Not authenticated')

    const previousProfile = currentProfile
    const nextUpdatedAt = new Date().toISOString()

    // 1. Instant optimistic local update
    if (currentProfile) {
      set({
        profile: {
          ...currentProfile,
          ...values,
          updated_at: nextUpdatedAt
        }
      })
    }

    try {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from('profiles')
        .update({
          ...values,
          updated_at: nextUpdatedAt
        })
        .eq('id', user.id)
        .select()
        .single()

      if (error) throw error
      set({ profile: data as OnlineProfile })
    } catch (err) {
      if (previousProfile) {
        set({ profile: previousProfile })
      }
      throw err
    }
  },

  uploadAvatar: async (file: File) => {
    const user = get().user
    const profile = get().profile
    if (!user || !profile) throw new Error('Not authenticated')

    const oldAvatar = profile.avatar_url
    const previewUrl = URL.createObjectURL(file)
    const optimisticUpdatedAt = new Date().toISOString()

    // 1. Instant optimistic update - 0ms response across the entire app
    set({
      profile: {
        ...profile,
        avatar_url: previewUrl,
        updated_at: optimisticUpdatedAt
      }
    })

    try {
      // 2. Upload file to Supabase storage in background
      const publicUrl = await uploadAvatarImage(file, user.id)

      // 3. Persist new publicUrl in Supabase profiles
      const { data, error } = await getSupabase()
        .from('profiles')
        .update({
          avatar_url: publicUrl,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id)
        .select()
        .single()

      if (error) throw error

      set({ profile: data as OnlineProfile })

      // Clean up local blob object URL
      if (previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl)
      }

      // Delete old avatar from storage if replaced
      if (oldAvatar && oldAvatar !== publicUrl) {
        void deleteAvatarImage(oldAvatar, user.id)
      }

      return publicUrl
    } catch (err) {
      // Revert optimistic update on error
      if (previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl)
      }
      set({ profile })
      throw err
    }
  },

  removeAvatar: async () => {
    const user = get().user
    const profile = get().profile
    if (!user || !profile) throw new Error('Not authenticated')

    const oldAvatar = profile.avatar_url
    const optimisticUpdatedAt = new Date().toISOString()

    // 1. Instant optimistic remove
    set({
      profile: {
        ...profile,
        avatar_url: null,
        updated_at: optimisticUpdatedAt
      }
    })

    try {
      const { data, error } = await getSupabase()
        .from('profiles')
        .update({
          avatar_url: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id)
        .select()
        .single()

      if (error) throw error
      set({ profile: data as OnlineProfile })

      if (oldAvatar) {
        void deleteAvatarImage(oldAvatar, user.id)
      }
    } catch (err) {
      set({ profile })
      throw err
    }
  }
}))
