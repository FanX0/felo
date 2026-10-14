-- Migration: 0009_listening_room_commands.sql
-- Enables Universal Discord Bot, Web Remote, and integrations to dispatch
-- commands to active listening rooms via 6-character room codes.

create table if not exists public.listening_room_commands (
  id uuid primary key default gen_random_uuid(),
  room_code text not null,
  command text not null, -- 'play', 'skip', 'pause', 'resume', 'volume'
  payload jsonb not null default '{}'::jsonb, -- { query: '...', action: 'play_now' | 'play_next' | 'enqueue', percent: 80 }
  sender_name text not null default 'Discord User',
  source text not null default 'discord', -- 'discord', 'webhook', 'web'
  status text not null default 'pending', -- 'pending', 'processed', 'failed'
  created_at timestamptz not null default now()
);

-- Index for instant lookup of pending commands by room code
create index if not exists listening_room_commands_code_status_idx
  on public.listening_room_commands(room_code, status, created_at desc);

-- Channel bindings table for Universal Bot (maps Discord Channel -> Room Code)
create table if not exists public.discord_channel_bindings (
  channel_id text primary key,
  guild_id text,
  room_code text not null,
  bound_by text,
  bound_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists discord_channel_bindings_code_idx
  on public.discord_channel_bindings(room_code);

-- Enable Row Level Security
alter table public.listening_room_commands enable row level security;
alter table public.discord_channel_bindings enable row level security;

-- Policies for listening_room_commands:
-- 1. Anyone with the room code can send a command (anonymous / authenticated / bot)
create policy "Allow inserting room commands"
  on public.listening_room_commands
  for insert
  with check (true);

-- 2. Anyone can read room commands for their room
create policy "Allow reading room commands"
  on public.listening_room_commands
  for select
  using (true);

-- 3. Allow updating status (e.g. host marks as processed)
create policy "Allow updating room command status"
  on public.listening_room_commands
  for update
  using (true);

-- Policies for discord_channel_bindings:
create policy "Allow reading discord channel bindings"
  on public.discord_channel_bindings
  for select
  using (true);

create policy "Allow inserting discord channel bindings"
  on public.discord_channel_bindings
  for insert
  with check (true);

create policy "Allow updating discord channel bindings"
  on public.discord_channel_bindings
  for update
  using (true);

create policy "Allow deleting discord channel bindings"
  on public.discord_channel_bindings
  for delete
  using (true);

-- Add to Realtime publication
alter publication supabase_realtime add table public.listening_room_commands;
