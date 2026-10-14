-- Allow the current host to transfer hosting without weakening the room RLS policy.
create or replace function public.transfer_listening_room_host(
  target_room_id uuid,
  new_host_id uuid
)
returns public.listening_rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_room public.listening_rooms;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if new_host_id = auth.uid() then
    raise exception 'The selected user is already the host.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.listening_rooms
    where id = target_room_id and host_id = auth.uid() and is_active = true
  ) then
    raise exception 'Only the current host can transfer hosting.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.listening_room_members
    where room_id = target_room_id and user_id = new_host_id
  ) then
    raise exception 'The selected user is not connected to this room.' using errcode = '22023';
  end if;

  update public.listening_rooms
  set host_id = new_host_id,
      song = null,
      position_seconds = 0,
      is_playing = false,
      updated_at = now()
  where id = target_room_id
  returning * into updated_room;

  return updated_room;
end;
$$;

revoke all on function public.transfer_listening_room_host(uuid, uuid) from public;
grant execute on function public.transfer_listening_room_host(uuid, uuid) to authenticated;

-- Make the new RPC immediately visible to the PostgREST API after migration.
notify pgrst, 'reload schema';
