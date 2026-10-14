# Felo 🎵

<p align="center">
  <strong>A modern, local-first music player and library workspace for audiophiles and music collectors.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" alt="License: MIT" />
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Web%20%7C%20Android-informational.svg?style=flat-square" alt="Platforms" />
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Electron-47848F?style=flat-square&logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB" alt="React" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=flat-square&logo=tailwind-css&logoColor=white" alt="Tailwind CSS" />
</p>

---

## 🌟 Overview

**Felo** is a high-performance personal audio player designed from the ground up for listening to your local music collection. Built with Electron, React, and TypeScript, Felo combines the elegance of modern streaming interfaces with the privacy, ownership, and fidelity of a local library manager.

Whether managing thousands of lossless FLAC files on your desktop or controlling playback from your phone across your living room, Felo provides a seamless, distraction-free listening experience with **zero ad tracking and zero telemetry**.

---

## ✨ Features

### 🎧 Local-First High-Fidelity Audio
- **Broad Audio Format Support**: Plays FLAC, ALAC, WAV, AAC, MP3, OGG, Opus, and DSD with native decoding.
- **Studio Equalizer & Crossfade**: Smooth gapless playback, custom crossfade curves, and audio equalization.
- **Large Library Performance**: Virtualized scroll engine capable of handling **100,000+ songs** smoothly without UI lag.
- **Rich Metadata & Embedded Art**: High-resolution cover art extraction, artist parsing, and multi-artist credit breakdown.

### 🧠 Offline Personalization & Smart Mixes
- **Local Listening Metrics**: Understand your top genres, most-played artists, and weekly habits without sending data to any cloud service.
- **Auto-Generated Mixes**: Intelligent mix generation tailored to your library (*"On Repeat"*, *"Time Capsule"*, *"Forgotten Gems"*).
- **Infinite Radio**: Continuous smart playback queue seeded from your favorite local tracks.

### 📱 Phone Remote & Device Handover
- **Mobile Companion**: Control desktop volume, play/pause, queue, and tracks directly from your phone's browser or mobile app.
- **WebRTC Studio Audio Streaming**: Stream audio in real-time from your PC to your phone or wireless speakers over local Wi-Fi.
- **Instant QR Pairing**: Scan a QR code on your desktop screen to link your mobile device immediately.

### 👥 Listen Together (Realtime Social Rooms)
- **Synchronized Listening**: Host or join shared listening rooms with friends powered by Supabase Realtime.
- **In-Room Chat & Reaction**: Discuss music in real time, queue up tracks collaboratively, and share playlist links.
- **Peer-to-Peer Live Audio**: Stream live audio feeds to remote listeners with adaptive bitrate Opus compression.

### 📜 Synchronized Lyrics
- **Karaoke & Timed Lyrics**: Live synchronized scrolling lyrics automatically retrieved from open public databases ([LRCLIB](https://lrclib.net)).
- **Clean Fallback**: Plaintext and translation modes for uninterrupted listening.

---

## 🛠️ Architecture & Safe Open-Source Mode

| Environment | Mode | Capabilities |
| :--- | :--- | :--- |
| **Desktop App (Electron)** | Full Local Player | Local library management, file tagging, local metadata index, phone remote server, audio output engine. |
| **Web Deployment (Cloudflare)** | Safe Public Web | Browser audio playback, Listen Together rooms, remote control phone client, local file import. |

> [!NOTE]
> **Safety Guarantee**: The public web deployment and open-source repository operate strictly in **local-first mode**. No proprietary scrapers, external catalog piracy tools, or copyrighted media streams are bundled or accessed. All playback is driven by the user's personal media files.

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or later recommended)
- `npm` or `pnpm`

### Installation

```bash
# Clone the repository
git clone https://github.com/FanX0/felo.git
cd felo

# Install dependencies
npm install
```

### Development Mode

```bash
# Run Electron desktop app in development mode
npm run dev
```

### Type Checking & Code Quality

```bash
# Run full project type checking (main process + renderer)
npm run typecheck
```

---

## 🌐 Supabase Configuration (Optional for Realtime & Listen Together)

To enable social rooms, friend activity, and realtime listening sessions:

1. Create a free project on [Supabase](https://supabase.com).
2. Copy `.env.example` to `.env` in the project root:
   ```env
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   DATABASE_URL=postgresql://postgres:your-password@db.your-project.supabase.co:5432/postgres
   ```
3. Apply the database migration in the Supabase SQL Editor:
   - File: `supabase/migrations/0000_online_features.sql`
4. Enable OAuth providers (Google / Discord) under **Authentication > Providers** if social login is desired.

---

## 📦 Building for Distribution

### Desktop Binaries

```bash
# Windows (.exe installer & portable)
npm run build:win

# macOS (.dmg & .zip)
npm run build:mac

# Linux (.AppImage & .deb)
npm run build:linux
```

### Web & Cloudflare Deployment

```bash
# Compile client web bundle
npm run build:web

# Deploy to Cloudflare Pages
npm run deploy:cf

# Deploy to Cloudflare Workers Static Assets
npm run deploy:worker
```

---

## 🔒 Security & Privacy

- **Zero Tracking**: No Google Analytics, telemetry, or user behavior tracking.
- **Local Database**: All library indexing and playback history is stored in a private local SQLite database on your device.
- **End-to-End Encryption**: WebRTC audio and remote pairing connections utilize DTLS-SRTP encryption over authenticated channels.

---

## ⚖️ Legal & Disclaimer

- **Personal Use**: Felo is an independent, local-first personal audio player and library manager designed exclusively for organizing and playing legally acquired media collections.
- **No Hosting**: Felo does not host, store, cache, distribute, or stream copyrighted audio files.
- **Public Open Metadata**: All track metadata, artist bios, and lyrics are retrieved from open and public community databases (such as MusicBrainz and LRCLIB) under fair use and their respective open developer terms.
- **Affiliation**: Felo is not affiliated with, endorsed by, or sponsored by any streaming service or external music platform.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
