import type { HomeSongItem, HomeAlbumItem } from '../types'

export const HOME_RECOMMENDED_SONGS_KEY = 'felo_home_recommended_songs'
export const HOME_RECOMMENDED_ALBUMS_KEY = 'felo_home_recommended_albums'

export const CURATED_DEFAULT_SONGS: HomeSongItem[] = [
  {
    id: 'curated-1',
    title: "Don't Worry My Love",
    artist: 'KAIVON',
    year: '2021',
    duration: 187,
    quality: 'FLAC',
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/4b/3e/2a/4b3e2a0f-1555-e41c-3b95-d2ad4f7a2db1/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'curated-2',
    title: 'worth my weight in gold',
    artist: 'One Hope',
    year: '2020',
    duration: 167,
    quality: 'FLAC',
    isExplicit: true,
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/bf/25/7e/bf257e84-1886-f131-0118-2e069c9b4e54/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'curated-3',
    title: '1&Only',
    artist: 'XLOV',
    year: '2025',
    duration: 175,
    quality: 'FLAC',
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/0d/16/e0/0d16e0b7-4b72-f1df-29bb-432d6fb601ab/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'curated-4',
    title: '2.0',
    artist: 'BTS',
    year: '2026',
    duration: 170,
    quality: 'HD FLAC',
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/d5/43/e7/d543e742-b062-8418-5a21-987819ea2bcf/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'curated-5',
    title: 'like JENNIE',
    artist: 'JENNIE',
    year: '2025',
    duration: 124,
    quality: 'HD FLAC',
    isExplicit: true,
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/71/54/1b/71541bee-b9d9-bbba-c397-bb783709b119/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'curated-6',
    title: 'Go To Sleep (feat. Kailee Morgue)',
    artist: 'Bearson, Kailee Morgue',
    year: '2018',
    duration: 227,
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music128/v4/e5/2a/e0/e52ae07b-8ffc-18ff-5561-26c79aebc19b/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'curated-7',
    title: '1-800-hot-n-fun',
    artist: 'LE SSERAFIM',
    year: '2024',
    duration: 173,
    quality: 'FLAC',
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/58/63/12/58631248-cb58-2940-d9d8-9477eb372767/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'curated-8',
    title: 'Walls Down',
    artist: 'MEMBA, Evan Gila',
    year: '2021',
    duration: 193,
    quality: 'FLAC',
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/e4/2d/cb/e42dcb20-6eb6-dc3c-851a-7b3bc0c4d296/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'curated-9',
    title: 'Broken',
    artist: 'Bryce Savage',
    year: '2022',
    duration: 134,
    quality: 'FLAC',
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music112/v4/80/cb/c7/80cbc7bf-d8dc-0676-e175-1033621ae1c0/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'curated-10',
    title: 'SWIM',
    artist: 'BTS',
    year: '2026',
    duration: 159,
    quality: 'HD FLAC',
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/91/9a/9a/919a9a3b-c56a-1296-1c25-06be44d9326e/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'curated-11',
    title: "I'm a Sucker for a Liar in a Red Dress",
    artist: 'Adam Jensen',
    year: '2022',
    duration: 224,
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music122/v4/05/bb/e6/05bbe686-e7e7-eeec-67a3-5c74381ae2bc/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'curated-12',
    title: 'Never Done This',
    artist: 'twocolors',
    year: '2023',
    duration: 177,
    quality: 'FLAC',
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/e5/7a/7d/e57a7d45-66ec-7ae1-ae86-ca4587db287e/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'curated-13',
    title: 'Hypnotize',
    artist: 'Fairlane, Grant',
    year: '2022',
    duration: 188,
    quality: 'FLAC',
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/80/7e/d3/807ed33f-80ff-27c1-7d1d-bb61f8a85e49/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'curated-14',
    title: 'Visionaries (feat. Novet)',
    artist: 'Inzo',
    year: '2017',
    duration: 283,
    quality: 'FLAC',
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music128/v4/ee/12/37/ee1237a8-12c8-89c5-8495-231f82f25b29/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'curated-15',
    title: 'Invisible',
    artist: 'Julius Dreisig, Zeus X Crona',
    year: '2018',
    duration: 201,
    quality: 'HD FLAC',
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music128/v4/21/5a/03/215a0376-e82b-0f62-3117-6ffecbe3ebc0/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'curated-16',
    title: 'Run It (feat. Annika Wells)',
    artist: 'Midnight Kids',
    year: '2019',
    duration: 219,
    quality: 'FLAC',
    isExplicit: true,
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music123/v4/f4/64/a1/f464a132-7212-32b0-96f3-9d1ef546c243/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'curated-17',
    title: 'IRIS OUT',
    artist: 'Kenshi Yonezu',
    year: '2025',
    duration: 152,
    quality: 'HD FLAC',
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/df/e3/37/dfe337e7-37fb-a1e4-8025-a13cb244e83f/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'curated-18',
    title: 'Pins & Needles (Xan Griffin Remix)',
    artist: '888',
    year: '2019',
    duration: 212,
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music118/v4/c3/97/bb/c397bb6e-8219-c705-cb6d-bfd6c7b39ea3/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'curated-19',
    title: 'Black Hole Sun',
    artist: 'Prismo',
    year: '2019',
    duration: 174,
    quality: 'FLAC',
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music113/v4/a7/b0/0f/a7b00fef-d897-4001-c866-e3d81bfa6bc9/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'curated-20',
    title: 'CEMETERY',
    artist: 'AViVA',
    year: '2020',
    duration: 186,
    quality: 'FLAC',
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/e5/b9/64/e5b96495-234b-4899-7ee4-245c4ffbdcba/artwork.jpg/600x600bb.jpg'
  }
]

export const CURATED_DEFAULT_ALBUMS: HomeAlbumItem[] = [
  {
    id: 'album-1',
    title: 'NEFFEX',
    artist: 'NEFFEX',
    year: '2023',
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/f8/fa/79/f8fa7916-7e24-c97e-884b-fa932148f36b/859720717961.jpg/600x600bb.jpg'
  },
  {
    id: 'album-2',
    title: 'FACELESS',
    artist: 'Unknown Brain',
    year: '2021',
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/e8/8a/ac/e88aac4b-2294-cf31-eaf2-b54c58f27158/8721465237023.png/600x600bb.jpg'
  },
  {
    id: 'album-3',
    title: 'DESTINY',
    artist: 'Slushii & Kaivon',
    year: '2022',
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/55/38/9f/55389f9a-7b67-8969-a9d1-3b9ef2fbae49/dj.pmvgkzof.jpg/600x600bb.jpg'
  },
  {
    id: 'album-4',
    title: 'METAMORPHOSIS',
    artist: 'The Score',
    year: '2022',
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Features114/v4/bc/5a/d1/bc5ad1cf-17f6-628e-dcad-8683dd321170/contsched.apmmhmuv.jpg/600x600bb.jpg'
  },
  {
    id: 'album-5',
    title: 'WALK THE MOON',
    artist: 'WALK THE MOON',
    year: '2021',
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/3f/c1/23/3fc1230f-42f9-3ae6-b593-9dbcfc85d4fc/886443385559.jpg/600x600bb.jpg'
  },
  {
    id: 'album-6',
    title: 'The Everlove',
    artist: 'The Everlove',
    year: '2020',
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/b2/a1/b8/b2a1b8b3-9cf1-ba41-ad9d-1c37560fee69/018736869525_cover.jpg/600x600bb.jpg'
  }
]
