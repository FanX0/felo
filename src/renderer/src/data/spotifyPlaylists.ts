export type SpotifySection = 'all' | 'popular' | 'charts' | 'trending' | 'new_music' | 'genres'

export interface SpotifyPlaylistItem {
  id: string
  title: string
  category: string
  badge: string
  update: string
  section: SpotifySection
  genreTag?: string
  artworkUrl?: string
}

export const spotifyPlaylists: SpotifyPlaylistItem[] = [
  // Popular Now
  {
    id: '37i9dQZF1DXcBWIGoYBM5M',
    title: "Today's Top Hits",
    category: 'Biggest global mainstream hits',
    badge: 'Popular',
    update: 'Frequent',
    section: 'popular',
    artworkUrl: 'https://i.scdn.co/image/ab67706f00000002526040498d89ec622e9d3495'
  },
  {
    id: '37i9dQZEVXbMDoHDwVN2tF',
    title: 'Top 50 - Global',
    category: 'Global daily chart',
    badge: 'Global',
    update: 'Daily',
    section: 'popular',
    artworkUrl: 'https://charts-images.scdn.co/assets/locale_en/regional/daily/region_global_default.jpg'
  },
  {
    id: '37i9dQZEVXbObFQZ3JLcXt',
    title: 'Top 50 - Indonesia',
    category: 'Indonesia daily chart',
    badge: 'Indonesia',
    update: 'Daily',
    section: 'popular',
    artworkUrl: 'https://charts-images.scdn.co/assets/locale_en/regional/daily/region_id_default.jpg'
  },
  {
    id: '37i9dQZF1DXa2EiKmMLhFD',
    title: 'Hot Hits Indonesia',
    category: 'Popular Indonesian & global hits',
    badge: 'Top Indonesia',
    update: 'Frequent',
    section: 'popular',
    artworkUrl: 'https://i.scdn.co/image/ab67706f000000027cc9e7f0910327618d8f15a1'
  },

  // Charts
  {
    id: '37i9dQZEVXbNG2KDcFcKOF',
    title: 'Top Songs - Global',
    category: 'Global weekly chart',
    badge: 'Global Weekly',
    update: 'Weekly',
    section: 'charts',
    artworkUrl: 'https://charts-images.scdn.co/assets/locale_en/regional/weekly/region_global_default.jpg'
  },
  {
    id: '37i9dQZEVXbIZK8aUquyx8',
    title: 'Top Songs - Indonesia',
    category: 'Indonesia weekly chart',
    badge: 'Indonesia Weekly',
    update: 'Weekly',
    section: 'charts',
    artworkUrl: 'https://charts-images.scdn.co/assets/locale_en/regional/weekly/region_id_default.jpg'
  },
  {
    id: '37i9dQZEVXbLRQDuF5jeBp',
    title: 'Top 50 - USA',
    category: 'United States daily chart',
    badge: 'USA',
    update: 'Daily',
    section: 'charts',
    artworkUrl: 'https://charts-images.scdn.co/assets/locale_en/regional/daily/region_us_default.jpg'
  },
  {
    id: '37i9dQZEVXbLnolsZ8PSNw',
    title: 'Top 50 - United Kingdom',
    category: 'UK daily chart',
    badge: 'UK',
    update: 'Daily',
    section: 'charts',
    artworkUrl: 'https://charts-images.scdn.co/assets/locale_en/regional/daily/region_gb_default.jpg'
  },
  {
    id: '37i9dQZEVXbKXQ4mDTEBXq',
    title: 'Top 50 - Japan',
    category: 'Japan daily chart',
    badge: 'Japan',
    update: 'Daily',
    section: 'charts',
    artworkUrl: 'https://charts-images.scdn.co/assets/locale_en/regional/daily/region_jp_default.jpg'
  },
  {
    id: '37i9dQZEVXbNxXF4SkHj9F',
    title: 'Top 50 - South Korea',
    category: 'South Korea daily chart',
    badge: 'Korea',
    update: 'Daily',
    section: 'charts',
    artworkUrl: 'https://charts-images.scdn.co/assets/locale_en/regional/daily/region_kr_default.jpg'
  },
  {
    id: '37i9dQZEVXbJPcfkRz0wJ0',
    title: 'Top 50 - Australia',
    category: 'Australia daily chart',
    badge: 'Australia',
    update: 'Daily',
    section: 'charts',
    artworkUrl: 'https://charts-images.scdn.co/assets/locale_en/regional/daily/region_au_default.jpg'
  },

  // Trending & Rising
  {
    id: '37i9dQZF1DWWhB4HOWKFQc',
    title: 'Lagi Viral',
    category: 'Viral songs in Indonesia',
    badge: 'Viral',
    update: 'Frequent',
    section: 'trending',
    artworkUrl: 'https://i.scdn.co/image/ab67706f0000000255fe9ec94cd29f4010ebf434'
  },
  {
    id: '37i9dQZF1DWUa8ZRTfalHk',
    title: 'Pop Rising',
    category: 'Global pop discovery',
    badge: 'Discovery',
    update: 'Frequent',
    section: 'trending',
    artworkUrl: 'https://i.scdn.co/image/ab67706f000000027a4c0bda7cb1e7b7e4ff88a7'
  },
  {
    id: '37i9dQZF1DX6yQB7bkflag',
    title: 'Pop Rising Indonesia',
    category: 'Indonesian pop discovery',
    badge: 'Rising',
    update: 'Frequent',
    section: 'trending',
    artworkUrl: 'https://i.scdn.co/image/ab67706f000000026307af1bb0326244b46092cf'
  },
  {
    id: '37i9dQZF1DWZxM58TRkuqg',
    title: 'Puncak Klasemen',
    category: 'Popular / new Indonesian music',
    badge: 'Trending',
    update: 'Frequent',
    section: 'trending',
    artworkUrl: 'https://i.scdn.co/image/ab67706f00000002158846f01d5138a777a8ad53'
  },

  // New Music
  {
    id: '37i9dQZF1DX4JAvHpjipBk',
    title: 'New Music Friday',
    category: 'Major new global releases',
    badge: 'Global New',
    update: 'Friday',
    section: 'new_music',
    artworkUrl: 'https://i.scdn.co/image/ab67706f000000022d28b6bbd790c5d6526c472b'
  },
  {
    id: '37i9dQZF1DX8vAahjzdXGC',
    title: 'New Music Friday Indonesia',
    category: 'New Indonesian & global releases',
    badge: 'Indonesia New',
    update: 'Friday',
    section: 'new_music',
    artworkUrl: 'https://i.scdn.co/image/ab67706f000000020c238636d3f169c3acd8900c'
  },

  // Genres
  {
    id: '37i9dQZF1DX0XUsuxWHRQd',
    title: 'RapCaviar',
    category: 'Global hip-hop / rap',
    badge: 'Hip-Hop',
    genreTag: 'Hip-Hop',
    update: 'Frequent',
    section: 'genres',
    artworkUrl: 'https://i.scdn.co/image/ab67706f00000002785c58430ad4196ef17ab19d'
  },
  {
    id: '37i9dQZF1DX4SBhb3fqCJd',
    title: 'RNB X',
    category: 'Current R&B',
    badge: 'R&B',
    genreTag: 'R&B',
    update: 'Frequent',
    section: 'genres',
    artworkUrl: 'https://i.scdn.co/image/ab67706f00000002a66d968e583d26aa4a440b1d'
  },
  {
    id: '37i9dQZF1DX9tPFwDMOaN1',
    title: 'K-Pop ON! (온)',
    category: 'Current K-pop hits',
    badge: 'K-Pop',
    genreTag: 'K-Pop',
    update: 'Frequent',
    section: 'genres',
    artworkUrl: 'https://i.scdn.co/image/ab67706f00000002223f69a579b1785b27618724'
  },
  {
    id: '37i9dQZF1DX10zKzsJ2jva',
    title: 'Viva Latino',
    category: 'Current Latin hits',
    badge: 'Latin',
    genreTag: 'Latin',
    update: 'Frequent',
    section: 'genres',
    artworkUrl: 'https://i.scdn.co/image/ab67706f000000020661dbe6a0e7dfe3629d4c4d'
  },
  {
    id: '37i9dQZF1DX4dyzvuaRJ0n',
    title: 'mint',
    category: 'Dance / electronic hits',
    badge: 'Electronic',
    genreTag: 'Electronic',
    update: 'Frequent',
    section: 'genres',
    artworkUrl: 'https://i.scdn.co/image/ab67706f0000000210fbd0e8781970615c0b64c0'
  },
  {
    id: '37i9dQZF1DX0kbJZpiYdZl',
    title: 'Hot Hits USA',
    category: 'Major US hits',
    badge: 'USA Hits',
    genreTag: 'Pop',
    update: 'Frequent',
    section: 'genres',
    artworkUrl: 'https://i.scdn.co/image/ab67706f000000020af5d3afe24316748a2a1bbd'
  },
  {
    id: '37i9dQZF1DX76Wlfdnj7AP',
    title: 'Beast Mode',
    category: 'Popular workout / rap',
    badge: 'Workout',
    genreTag: 'Workout',
    update: 'Frequent',
    section: 'genres',
    artworkUrl: 'https://i.scdn.co/image/ab67706f00000002f367481f06b565250cc7b139'
  },
  {
    id: '37i9dQZF1DX2M1RktxUUHG',
    title: 'All Out 2020s',
    category: '2020s hits & modern catalog',
    badge: '2020s',
    genreTag: 'Hits',
    update: 'Regular',
    section: 'genres',
    artworkUrl: 'https://i.scdn.co/image/ab67706f00000002e0eb2cf6bbb23429b40fba8b'
  }
]
