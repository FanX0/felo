-- Migration: 0014_listening_room_host_failover.sql
-- Automatically elect a new room host when the current host disconnects, lags out, or exits.
-- Includes concurrency protection against thundering herd elections via expected_old_host_id and FOR UPDATE locking.

create or replace function public.elect_new_room_host(
  target_room_id uuid,
  expected_old_host_id uuid default null
)
returns public.listening_rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  target_room public.listening_rooms;
  next_host_id uuid;
  updated_room public.listening_rooms;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  -- 1. Ensure caller is an active member of this room
  if not exists (
    select 1
    from public.listening_room_members
    where room_id = target_room_id and user_id = auth.uid()
  ) then
    raise exception 'You must be a member of this room to elect a host.' using errcode = '42501';
  end if;

  -- 2. Lock the room row for atomic update (prevents concurrent election stampedes)
  select * into target_room
  from public.listening_rooms
  where id = target_room_id and is_active = true
  for update;

  if target_room.id is null then
    return null;
  end if;

  -- 3. Idempotency check: if another guest already won the election race and changed the host,
  -- return the newly elected room immediately instead of re-electing someone else.
  if expected_old_host_id is not null and target_room.host_id <> expected_old_host_id then
    return target_room;
  end if;

  -- 4. Find the longest-standing active member who is NOT the disconnected host
  select user_id into next_host_id
  from public.listening_room_members
  where room_id = target_room_id and user_id <> target_room.host_id
  order by joined_at asc
  limit 1;

  if next_host_id is not null then
    -- Transfer host ownership to the next member
    update public.listening_rooms
    set host_id = next_host_id,
        updated_at = now()
    where id = target_room_id
    returning * into updated_room;

    return updated_room;
  else
    -- No remaining members, cleanly deactivate room
    update public.listening_rooms
    set is_active = false,
        is_playing = false,
        updated_at = now()
    where id = target_room_id
    returning * into updated_room;

    return null;
  end if;
end;
$$;

revoke all on function public.elect_new_room_host(uuid, uuid) from public;
grant execute on function public.elect_new_room_host(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
