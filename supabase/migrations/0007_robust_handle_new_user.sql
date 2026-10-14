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
