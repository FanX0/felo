insert into public.profiles (id, username, display_name)
select
  users.id,
  case
    when lower(coalesce(users.raw_user_meta_data->>'username', '')) ~ '^[a-z0-9_]{3,24}$'
      then lower(users.raw_user_meta_data->>'username')
    else 'user_' || substr(users.id::text, 1, 8)
  end,
  coalesce(
    nullif(users.raw_user_meta_data->>'display_name', ''),
    nullif(users.raw_user_meta_data->>'full_name', ''),
    split_part(coalesce(users.email, ''), '@', 1),
    'Felo listener'
  )
from auth.users as users
where not exists (select 1 from public.profiles where profiles.id = users.id)
on conflict do nothing;
