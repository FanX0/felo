-- Migration: 0004_listening_room_chat.sql
-- Table: listening_room_messages for real-time room chat

create table if not exists public.listening_room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.listening_rooms(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists lrm_room_created_idx
  on public.listening_room_messages(room_id, created_at);

alter table public.listening_room_messages enable row level security;

create or replace function public.is_room_member(target_room_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.listening_room_members
    where room_id = target_room_id and user_id = auth.uid()
  ) or exists (
    select 1 from public.listening_rooms
    where id = target_room_id and host_id = auth.uid()
  );
$$;

create policy "room members can read messages"
  on public.listening_room_messages for select
  to authenticated
  using (public.is_room_member(room_id));

create policy "room members can send messages"
  on public.listening_room_messages for insert
  to authenticated
  with check (
    sender_id = (select auth.uid())
    and public.is_room_member(room_id)
  );

do $$ begin
  alter publication supabase_realtime
    add table public.listening_room_messages;
exception when duplicate_object then null;
end $$;
