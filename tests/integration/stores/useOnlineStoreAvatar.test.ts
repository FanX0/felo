import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useOnlineStore } from '../../../src/renderer/src/stores/useOnlineStore'
import * as avatarLib from '../../../src/renderer/src/lib/avatar'
import * as supabaseLib from '../../../src/renderer/src/lib/supabase'

describe('useOnlineStore Avatar & Profile Optimistic Updates', () => {
  beforeEach(() => {
    vi.restoreAllMocks()

    // Initialize online store state with a dummy profile
    useOnlineStore.setState({
      user: { id: 'test-user-id', email: 'fanx@test.com' } as any,
      profile: {
        id: 'test-user-id',
        username: 'fanx46',
        display_name: 'FanX 46',
        bio: 'Music Lover',
        avatar_url: 'https://cdn.example.com/old-avatar.png',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z'
      }
    })
  })

  it('instantly and optimistically updates profile.avatar_url when uploadAvatar is called', async () => {
    let resolveUpload: (url: string) => void = () => {}
    const uploadPromise = new Promise<string>((resolve) => {
      resolveUpload = resolve
    })

    // Mock uploadAvatarImage to take time simulating real network transfer
    vi.spyOn(avatarLib, 'uploadAvatarImage').mockImplementation(() => uploadPromise)

    // Mock Supabase update
    const mockSupabaseUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'test-user-id',
              username: 'fanx46',
              display_name: 'FanX 46',
              bio: 'Music Lover',
              avatar_url: 'https://supabase.co/avatars/new-avatar.png',
              updated_at: new Date().toISOString()
            },
            error: null
          })
        })
      })
    })

    vi.spyOn(supabaseLib, 'getSupabase').mockReturnValue({
      from: vi.fn().mockReturnValue({
        update: mockSupabaseUpdate
      })
    } as any)

    const testFile = new File(['image-bytes'], 'avatar.png', { type: 'image/png' })

    // Call uploadAvatar
    const uploadAvatarPromise = useOnlineStore.getState().uploadAvatar(testFile)

    // Check store IMMEDIATELY (0ms, before network promise resolves)
    const immediateProfile = useOnlineStore.getState().profile
    expect(immediateProfile).not.toBeNull()
    expect(immediateProfile?.avatar_url).toMatch(/^blob:/)

    // Now let background upload resolve
    resolveUpload('https://supabase.co/avatars/new-avatar.png')
    const finalUrl = await uploadAvatarPromise

    expect(finalUrl).toBe('https://supabase.co/avatars/new-avatar.png')
    const updatedProfile = useOnlineStore.getState().profile
    expect(updatedProfile?.avatar_url).toBe('https://supabase.co/avatars/new-avatar.png')
  })

  it('reverts optimistic avatar update if upload fails', async () => {
    vi.spyOn(avatarLib, 'uploadAvatarImage').mockRejectedValue(new Error('Network upload failed'))

    const testFile = new File(['image-bytes'], 'avatar.png', { type: 'image/png' })

    await expect(useOnlineStore.getState().uploadAvatar(testFile)).rejects.toThrow(
      'Network upload failed'
    )

    // Store should revert back to original old avatar URL
    const revertedProfile = useOnlineStore.getState().profile
    expect(revertedProfile?.avatar_url).toBe('https://cdn.example.com/old-avatar.png')
  })

  it('instantly and optimistically removes avatar when removeAvatar is called', async () => {
    const mockSupabaseUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'test-user-id',
              username: 'fanx46',
              display_name: 'FanX 46',
              bio: 'Music Lover',
              avatar_url: null,
              updated_at: new Date().toISOString()
            },
            error: null
          })
        })
      })
    })

    vi.spyOn(supabaseLib, 'getSupabase').mockReturnValue({
      from: vi.fn().mockReturnValue({
        update: mockSupabaseUpdate
      })
    } as any)

    const removePromise = useOnlineStore.getState().removeAvatar()

    // Store should immediately show null avatar
    expect(useOnlineStore.getState().profile?.avatar_url).toBeNull()

    await removePromise
    expect(useOnlineStore.getState().profile?.avatar_url).toBeNull()
  })

  it('instantly and optimistically updates profile fields when updateProfile is called', async () => {
    let resolveUpdate: (val: any) => void = () => {}
    const updateDeferred = new Promise((resolve) => {
      resolveUpdate = resolve
    })

    const mockSupabaseUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockImplementation(() => updateDeferred)
        })
      })
    })

    vi.spyOn(supabaseLib, 'getSupabase').mockReturnValue({
      from: vi.fn().mockReturnValue({
        update: mockSupabaseUpdate
      })
    } as any)

    const updatePromise = useOnlineStore.getState().updateProfile({
      display_name: 'New Display Name',
      bio: 'Updated Bio'
    })

    // Store should immediately reflect new values
    expect(useOnlineStore.getState().profile?.display_name).toBe('New Display Name')
    expect(useOnlineStore.getState().profile?.bio).toBe('Updated Bio')

    resolveUpdate({
      data: {
        id: 'test-user-id',
        username: 'fanx46',
        display_name: 'New Display Name',
        bio: 'Updated Bio',
        avatar_url: 'https://cdn.example.com/old-avatar.png',
        updated_at: new Date().toISOString()
      },
      error: null
    })

    await updatePromise
    expect(useOnlineStore.getState().profile?.display_name).toBe('New Display Name')
  })
})
