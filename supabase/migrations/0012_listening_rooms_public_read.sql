-- Migration: 0012_listening_rooms_public_read.sql
-- Allow public / anon read access to active listening rooms so the Discord bot,
-- web listeners, and invite links can look up rooms by room code.

drop policy if exists "active rooms readable" on public.listening_rooms;

create policy "active rooms readable"
  on public.listening_rooms
  for select
  to public
  using (is_active or (auth.uid() is not null and host_id = auth.uid()));

drop policy if exists "room membership readable" on public.listening_room_members;

create policy "room membership readable"
  on public.listening_room_members
  for select
  to public
  using (true);
