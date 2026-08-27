create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null,
  bio text not null default '',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  title text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(), primary key (conversation_id, user_id)
);
create index if not exists conversation_members_user_idx on public.conversation_members(user_id);
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade, body text not null default '', song jsonb,
  created_at timestamptz not null default now(), check (length(body) > 0 or song is not null)
);
create index if not exists messages_conversation_created_idx on public.messages(conversation_id, created_at);

create table if not exists public.shared_playlists (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null, description text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.shared_playlist_members (
  playlist_id uuid not null references public.shared_playlists(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'editor' check (role in ('owner', 'editor', 'viewer')),
  joined_at timestamptz not null default now(), primary key (playlist_id, user_id)
);
create index if not exists shared_playlist_members_user_idx on public.shared_playlist_members(user_id);
create table if not exists public.shared_playlist_items (
  id uuid primary key default gen_random_uuid(), playlist_id uuid not null references public.shared_playlists(id) on delete cascade,
  added_by uuid not null references auth.users(id) on delete cascade, song jsonb not null, position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists shared_playlist_items_playlist_idx on public.shared_playlist_items(playlist_id, position);

create table if not exists public.listening_rooms (
  id uuid primary key default gen_random_uuid(), host_id uuid not null references auth.users(id) on delete cascade,
  code text not null unique, name text not null, is_active boolean not null default true, song jsonb,
  position_seconds integer not null default 0, is_playing boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.listening_room_members (
  room_id uuid not null references public.listening_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(), primary key (room_id, user_id)
);
create index if not exists listening_room_members_user_idx on public.listening_room_members(user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_username text;
  clean_display_name text;
  user_avatar text;
begin
  -- 1. Extract and sanitize username
  clean_username := lower(coalesce(
    new.raw_user_meta_data->>'username',
    new.raw_user_meta_data->>'user_name',
    ''
  ));

  -- Replace any characters not allowed by regex ^[a-z0-9_]{3,24}$
  clean_username := regexp_replace(clean_username, '[^a-z0-9_]', '_', 'g');

  -- If username does not match 3-24 valid chars, generate a deterministic fallback
  if clean_username !~ '^[a-z0-9_]{3,24}$' then
    clean_username := 'user_' || substr(replace(new.id::text, '-', ''), 1, 8);
  end if;

  -- 2. Extract display name with multiple fallback sources
  clean_display_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Felo Listener'
  );

  -- 3. Extract avatar URL from OAuth metadata
  user_avatar := coalesce(
    new.raw_user_meta_data->>'avatar_url',
    new.raw_user_meta_data->>'picture',
    null
  );

  -- 4. Insert profile with conflict handling
  insert into public.profiles (id, username, display_name, avatar_url)
  values (new.id, clean_username, clean_display_name, user_avatar)
  on conflict (id) do update set
    display_name = excluded.display_name,
    avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url);

  return new;
exception
  when unique_violation then
    -- Handle rare username uniqueness collision
    insert into public.profiles (id, username, display_name, avatar_url)
    values (
      new.id,
      'user_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
      clean_display_name,
      user_avatar
    )
    on conflict (id) do nothing;
    return new;
  when others then
    -- Prevent unexpected errors from blocking auth signup
    return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.shared_playlists enable row level security;
alter table public.shared_playlist_members enable row level security;
alter table public.shared_playlist_items enable row level security;
alter table public.listening_rooms enable row level security;
alter table public.listening_room_members enable row level security;

create or replace function public.is_conversation_member(target_id uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversation_members where conversation_id = target_id and user_id = auth.uid());
$$;
create or replace function public.owns_conversation(target_id uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversations where id = target_id and owner_id = auth.uid());
$$;
create or replace function public.is_playlist_member(target_id uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.shared_playlist_members where playlist_id = target_id and user_id = auth.uid());
$$;
create or replace function public.can_edit_playlist(target_id uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.shared_playlist_members where playlist_id = target_id and user_id = auth.uid() and role in ('owner','editor'));
$$;
create or replace function public.owns_playlist(target_id uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.shared_playlists where id = target_id and owner_id = auth.uid());
$$;

create policy "profiles readable by users" on public.profiles for select to authenticated using (true);
create policy "profiles editable by owner" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "conversation members can read" on public.conversations for select to authenticated using (public.is_conversation_member(id));
create policy "users can create conversations" on public.conversations for insert to authenticated with check (owner_id = auth.uid());
create policy "owners can update conversations" on public.conversations for update to authenticated using (owner_id = auth.uid());
create policy "conversation membership readable" on public.conversation_members for select to authenticated using (public.is_conversation_member(conversation_id) or public.owns_conversation(conversation_id));
create policy "owners can add members" on public.conversation_members for insert to authenticated with check (user_id = auth.uid() or public.owns_conversation(conversation_id));
create policy "members can read messages" on public.messages for select to authenticated using (public.is_conversation_member(conversation_id));
create policy "members can send messages" on public.messages for insert to authenticated with check (sender_id = auth.uid() and public.is_conversation_member(conversation_id));

create policy "playlist members can read" on public.shared_playlists for select to authenticated using (owner_id = auth.uid() or public.is_playlist_member(id));
create policy "users can create playlists" on public.shared_playlists for insert to authenticated with check (owner_id = auth.uid());
create policy "owners can update playlists" on public.shared_playlists for update to authenticated using (owner_id = auth.uid());
create policy "playlist members readable" on public.shared_playlist_members for select to authenticated using (public.is_playlist_member(playlist_id) or public.owns_playlist(playlist_id));
create policy "playlist owners can add members" on public.shared_playlist_members for insert to authenticated with check (user_id = auth.uid() or public.owns_playlist(playlist_id));
create policy "playlist items readable" on public.shared_playlist_items for select to authenticated using (public.is_playlist_member(playlist_id));
create policy "playlist editors can add" on public.shared_playlist_items for insert to authenticated with check (added_by = auth.uid() and public.can_edit_playlist(playlist_id));
create policy "playlist editors can remove" on public.shared_playlist_items for delete to authenticated using (public.can_edit_playlist(playlist_id));

create policy "active rooms readable" on public.listening_rooms for select to authenticated using (is_active or host_id = auth.uid());
create policy "users can create rooms" on public.listening_rooms for insert to authenticated with check (host_id = auth.uid());
create policy "hosts control rooms" on public.listening_rooms for update to authenticated using (host_id = auth.uid()) with check (host_id = auth.uid());
create policy "room membership readable" on public.listening_room_members for select to authenticated using (true);
create policy "users can join rooms" on public.listening_room_members for insert to authenticated with check (user_id = auth.uid());
create policy "users can leave rooms" on public.listening_room_members for delete to authenticated using (user_id = auth.uid());

do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.shared_playlist_items;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.listening_rooms;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.listening_room_members;
exception when duplicate_object then null; end $$;
