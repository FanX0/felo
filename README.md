# Felo

Felo is a desktop music player and local library workspace built with Electron, React, and TypeScript.

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

## Supabase Online Features

1. Create a Supabase project.
2. Copy `.env.example` to `.env` and add the project URL, anon key, and PostgreSQL connection string.
3. Apply `supabase/migrations/0000_online_features.sql` in the Supabase SQL editor.
4. Start the app with `npm run dev`, then register from the profile menu.

The migration enables row-level security and Realtime for chat, collaborative playlists, and listening rooms. Drizzle schema changes can be generated with `npm run db:generate` and applied to a configured project with `npm run db:push`.

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```
