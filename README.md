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
# Windows Installer (.exe setup)
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

## 🧪 Testing & Quality Assurance

Felo adheres to an industry-standard testing pyramid with **Vitest**, **React Testing Library**, and **Playwright for Electron**:

```bash
# Run all unit and integration test suites
npm test

# Run tests in interactive watch mode
npm run test:watch

# Run unit tests only (Shared, Main, Renderer)
npm run test:unit

# Run integration tests only (Zustand Stores, React Components)
npm run test:integration

# Generate code coverage report (V8)
npm run test:coverage

# Full CI validation (Typecheck + Coverage)
npm run test:ci

# Run Playwright Electron End-to-End tests (requires build)
npm run test:e2e
```

---

## 🔒 Security & Privacy

- **Zero Tracking**: No Google Analytics, telemetry, or user behavior tracking.
- **Local Database**: All library indexing and playback history is stored in a private local SQLite database on your device.
- **End-to-End Encryption**: WebRTC audio and remote pairing connections utilize DTLS-SRTP encryption over authenticated channels.

---

## ⚖️ Legal, Copyright & Compliance Disclaimer

> [!IMPORTANT]
> **Please read this disclaimer carefully before using, building, or contributing to Felo.**

### 1. Primary Purpose: Personal Local-First Media Player
**Felo** is an independent, local-first software application engineered exclusively for organizing, cataloging, and playing legally acquired personal audio collections (such as FLAC, ALAC, WAV, AAC, and MP3 files stored locally on your device). It is provided strictly as a multimedia player, playback workstation, and personal remote-control tool.

### 2. No Content Hosting or Media Distribution
- Felo **does not** host, store, mirror, cache, stream, or distribute any copyrighted sound recordings, musical works, or media files.
- The software operates entirely client-side on the user's local hardware. All audio playback occurs strictly from media files located on the user's local disk or authorized personal storage.

### 3. DMCA & Anti-Circumvention (Section 1201) Compliance
- This open-source repository contains **zero DRM circumvention mechanisms**, **zero unauthorized stream-decrypting utilities**, and **zero proprietary encryption keys**.
- The software relies exclusively on standard open-source audio codecs, public operating system multimedia frameworks, and documented community APIs.
- The project maintainers do not endorse, develop, or distribute unauthorized tools designed to bypass technological protection measures (TPMs) of commercial streaming platforms.

### 4. Third-Party Trademarks & Nominative Fair Use
- **Spotify, Apple Music, Deezer, Qobuz, YouTube, Discord, LRCLIB, MusicBrainz**, and other third-party brand names, product titles, and logos referenced within this documentation, user interface, or code are the registered trademarks of their respective owners.
- Any reference to these third-party names or integration formats is made solely for **nominative identification and technical interoperability** purposes (e.g., describing support for open playlist metadata imports or external display status).
- Felo is an independent project and is **not** endorsed by, sponsored by, partnered with, or affiliated with Spotify AB, Apple Inc., Deezer S.A., Xandrie S.A. (Qobuz), Google LLC, or Discord Inc.

### 5. Metadata and Community APIs
- Open public metadata (album covers, artist discographies, release dates) and synchronized lyrics are queried on demand from community-maintained, open databases (such as [MusicBrainz](https://musicbrainz.org) and [LRCLIB](https://lrclib.net)) in compliance with their respective open developer guidelines and fair use standards.

### 6. User Responsibility & Acceptable Use
- Users of Felo are solely and entirely responsible for ensuring that their personal media library and use of this software comply with all applicable local, national, and international copyright laws and licensing terms in their respective jurisdictions.
- The developers, maintainers, and contributors of Felo assume **no liability** for any unauthorized, unlawful, or infringing actions conducted by individual users of this software.

### 7. Limitation of Liability
This software is provided under the terms of the MIT License:
> **THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.**

### 8. DMCA / Rights Holder Inquiries
If you are a copyright or trademark holder and believe that any documentation or material in this repository inadvertently violates your rights, please open an issue on the GitHub repository or contact the project maintainer directly. Inquiries will be reviewed and addressed cooperatively and promptly.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

