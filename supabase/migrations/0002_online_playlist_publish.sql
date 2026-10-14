alter table public.shared_playlists
  add column if not exists source_local_playlist_id text;

create unique index if not exists shared_playlists_owner_local_source_idx
  on public.shared_playlists (owner_id, source_local_playlist_id)
  where source_local_playlist_id is not null;

create or replace function public.are_friends(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.friend_requests
    where status = 'accepted'
      and (
        (requester_id = auth.uid() and addressee_id = target_user_id)
        or (addressee_id = auth.uid() and requester_id = target_user_id)
      )
  );
$$;

drop policy if exists "playlist owners can add members" on public.shared_playlist_members;
create policy "playlist owners can add friends"
  on public.shared_playlist_members for insert to authenticated
  with check (
    user_id = auth.uid()
    or (public.owns_playlist(playlist_id) and public.are_friends(user_id))
  );

create or replace function public.publish_local_playlist(
  local_playlist_id text,
  playlist_name text,
  playlist_description text default '',
  songs jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  published_playlist_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;
  if nullif(trim(local_playlist_id), '') is null then
    raise exception 'Local playlist ID is required';
  end if;
  if nullif(trim(playlist_name), '') is null then
    raise exception 'Playlist name is required';
  end if;
  if jsonb_typeof(coalesce(songs, '[]'::jsonb)) <> 'array' then
    raise exception 'Songs must be a JSON array';
  end if;

  insert into public.shared_playlists (
    owner_id,
    name,
    description,
    source_local_playlist_id,
    updated_at
  )
  values (
    auth.uid(),
    trim(playlist_name),
    coalesce(playlist_description, ''),
    trim(local_playlist_id),
    now()
  )
  on conflict (owner_id, source_local_playlist_id)
    where source_local_playlist_id is not null
  do update set
    name = excluded.name,
    description = excluded.description,
    updated_at = now()
  returning id into published_playlist_id;

  insert into public.shared_playlist_members (playlist_id, user_id, role)
  values (published_playlist_id, auth.uid(), 'owner')
  on conflict (playlist_id, user_id) do update set role = 'owner';

  delete from public.shared_playlist_items
  where playlist_id = published_playlist_id;

  insert into public.shared_playlist_items (playlist_id, added_by, song, position)
  select
    published_playlist_id,
    auth.uid(),
    jsonb_strip_nulls(
      jsonb_build_object(
        'localId', song_data->>'localId',
        'title', trim(song_data->>'title'),
        'artist', coalesce(nullif(trim(song_data->>'artist'), ''), 'Unknown Artist'),
        'album', nullif(trim(song_data->>'album'), ''),
        'duration', nullif(song_data->>'duration', '')::double precision,
        'artworkUrl', nullif(trim(song_data->>'artworkUrl'), '')
      )
    ),
    song_position - 1
  from jsonb_array_elements(coalesce(songs, '[]'::jsonb))
    with ordinality as playlist_song(song_data, song_position)
  where nullif(trim(song_data->>'title'), '') is not null;

  return published_playlist_id;
end;
$$;

grant execute on function public.publish_local_playlist(text, text, text, jsonb) to authenticated;
