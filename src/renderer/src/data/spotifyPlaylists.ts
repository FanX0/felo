export type SpotifySection = 'all' | 'popular' | 'charts' | 'trending' | 'new_music' | 'genres'

export interface SpotifyPlaylistItem {
  id: string
  title: string
  category: string
  badge: string
  update: string
  section: SpotifySection
  genreTag?: string
}

export const spotifyPlaylists: SpotifyPlaylistItem[] = [
  // 🔥 Popular Now
  {
    id: '37i9dQZF1DXcBWIGoYBM5M',
    title: "Today's Top Hits",
    category: 'Biggest global mainstream hits',
    badge: '🔥 Popular',
    update: 'Frequent',
    section: 'popular'
  },
  {
    id: '37i9dQZEVXbMDoHDwVN2tF',
    title: 'Top 50 - Global',
    category: 'Global daily chart',
    badge: '🌎 Global',
    update: 'Daily',
    section: 'popular'
  },
  {
    id: '37i9dQZEVXbObFQZ3JLcXt',
    title: 'Top 50 - Indonesia',
    category: 'Indonesia daily chart',
    badge: '🇮🇩 Indonesia',
    update: 'Daily',
    section: 'popular'
  },
  {
    id: '37i9dQZF1DXa2EiKmMLhFD',
    title: 'Hot Hits Indonesia',
    category: 'Popular Indonesian & global hits',
    badge: '🇮🇩 Popular',
    update: 'Frequent',
    section: 'popular'
  },

  // 📈 Charts
  {
    id: '37i9dQZEVXbNG2KDcFcKOF',
    title: 'Top Songs - Global',
    category: 'Global weekly chart',
    badge: '🌎 Global',
    update: 'Weekly',
    section: 'charts'
  },
  {
    id: '37i9dQZEVXbIZK8aUquyx8',
    title: 'Top Songs - Indonesia',
    category: 'Indonesia weekly chart',
    badge: '🇮🇩 Indonesia',
    update: 'Weekly',
    section: 'charts'
  },
  {
    id: '37i9dQZEVXbLRQDuF5jeBp',
    title: 'Top 50 - USA',
    category: 'United States daily chart',
    badge: '🇺🇸 USA',
    update: 'Daily',
    section: 'charts'
  },
  {
    id: '37i9dQZEVXbLnolsZ8PSNw',
    title: 'Top 50 - United Kingdom',
    category: 'UK daily chart',
    badge: '🇬🇧 UK',
    update: 'Daily',
    section: 'charts'
  },
  {
    id: '37i9dQZEVXbKXQ4mDTEBXq',
    title: 'Top 50 - Japan',
    category: 'Japan daily chart',
    badge: '🇯🇵 Japan',
    update: 'Daily',
    section: 'charts'
  },
  {
    id: '37i9dQZEVXbNxXF4SkHj9F',
    title: 'Top 50 - South Korea',
    category: 'South Korea daily chart',
    badge: '🇰🇷 Korea',
    update: 'Daily',
    section: 'charts'
  },
  {
    id: '37i9dQZEVXbJPcfkRz0wJ0',
    title: 'Top 50 - Australia',
    category: 'Australia daily chart',
    badge: '🇦🇺 Australia',
    update: 'Daily',
    section: 'charts'
  },

  // 🚀 Trending & Rising
  {
    id: '37i9dQZF1DWWhB4HOWKFQc',
    title: 'Lagi Viral',
    category: 'Viral songs in Indonesia',
    badge: '🇮🇩 Viral',
    update: 'Frequent',
    section: 'trending'
  },
  {
    id: '37i9dQZF1DWUa8ZRTfalHk',
    title: 'Pop Rising',
    category: 'Global pop discovery',
    badge: '🚀 Discovery',
    update: 'Frequent',
    section: 'trending'
  },
  {
    id: '37i9dQZF1DX6yQB7bkflag',
    title: 'Pop Rising Indonesia',
    category: 'Indonesian pop discovery',
    badge: '🇮🇩 Rising',
    update: 'Frequent',
    section: 'trending'
  },
  {
    id: '37i9dQZF1DWZxM58TRkuqg',
    title: 'Puncak Klasemen',
    category: 'Popular / new Indonesian music',
    badge: '🇮🇩 Popular',
    update: 'Frequent',
    section: 'trending'
  },

  // ✨ New Music
  {
    id: '37i9dQZF1DX4JAvHpjipBk',
    title: 'New Music Friday',
    category: 'Major new global releases',
    badge: '🆕 Global',
    update: 'Friday',
    section: 'new_music'
  },
  {
    id: '37i9dQZF1DX8vAahjzdXGC',
    title: 'New Music Friday Indonesia',
    category: 'New Indonesian & global releases',
    badge: '🇮🇩 New',
    update: 'Friday',
    section: 'new_music'
  },

  // 🎵 Genres
  {
    id: '37i9dQZF1DX0XUsuxWHRQd',
    title: 'RapCaviar',
    category: 'Global hip-hop / rap',
    badge: '🎤 Hip-Hop',
    genreTag: 'Hip-Hop',
    update: 'Frequent',
    section: 'genres'
  },
  {
    id: '37i9dQZF1DX4SBhb3fqCJd',
    title: 'RNB X',
    category: 'Current R&B',
    badge: '💜 R&B',
    genreTag: 'R&B',
    update: 'Frequent',
    section: 'genres'
  },
  {
    id: '37i9dQZF1DX9tPFwDMOaN1',
    title: 'K-Pop ON! (온)',
    category: 'Current K-pop hits',
    badge: '🇰🇷 K-Pop',
    genreTag: 'K-Pop',
    update: 'Frequent',
    section: 'genres'
  },
  {
    id: '37i9dQZF1DX10zKzsJ2jva',
    title: 'Viva Latino',
    category: 'Current Latin hits',
    badge: '🌴 Latin',
    genreTag: 'Latin',
    update: 'Frequent',
    section: 'genres'
  },
  {
    id: '37i9dQZF1DX4dyzvuaRJ0n',
    title: 'mint',
    category: 'Dance / electronic hits',
    badge: '🎧 Electronic',
    genreTag: 'Electronic',
    update: 'Frequent',
    section: 'genres'
  },
  {
    id: '37i9dQZF1DX0kbJZpiYdZl',
    title: 'Hot Hits USA',
    category: 'Major US hits',
    badge: '🇺🇸 Popular',
    genreTag: 'Pop',
    update: 'Frequent',
    section: 'genres'
  },
  {
    id: '37i9dQZF1DX76Wlfdnj7AP',
    title: 'Beast Mode',
    category: 'Popular workout / rap',
    badge: '🏋️ Workout',
    genreTag: 'Workout',
    update: 'Frequent',
    section: 'genres'
  },
  {
    id: '37i9dQZF1DX2M1RktxUUHG',
    title: 'All Out 2020s',
    category: '2020s hits & modern catalog',
    badge: '🕺 2020s',
    genreTag: 'Hits',
    update: 'Regular',
    section: 'genres'
  }
]
