create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_id <> addressee_id)
);

create unique index if not exists friend_requests_pair_idx
  on public.friend_requests (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index if not exists friend_requests_requester_idx on public.friend_requests(requester_id);
create index if not exists friend_requests_addressee_idx on public.friend_requests(addressee_id);

create or replace function public.protect_friend_request_update() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.requester_id <> old.requester_id or new.addressee_id <> old.addressee_id then
    raise exception 'Friend request participants cannot be changed';
  end if;
  if old.status <> 'pending' or new.status <> 'accepted' then
    raise exception 'Only pending friend requests can be accepted';
  end if;
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists protect_friend_request_update on public.friend_requests;
create trigger protect_friend_request_update before update on public.friend_requests
  for each row execute procedure public.protect_friend_request_update();

alter table public.friend_requests enable row level security;

create policy "friend relationships readable by participants"
  on public.friend_requests for select to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

create policy "users can send friend requests"
  on public.friend_requests for insert to authenticated
  with check (requester_id = auth.uid() and requester_id <> addressee_id and status = 'pending');

create policy "recipients can accept friend requests"
  on public.friend_requests for update to authenticated
  using (addressee_id = auth.uid() and status = 'pending')
  with check (addressee_id = auth.uid() and status = 'accepted');

create policy "participants can remove friend relationships"
  on public.friend_requests for delete to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

do $$ begin
  alter publication supabase_realtime add table public.friend_requests;
exception when duplicate_object then null; end $$;
