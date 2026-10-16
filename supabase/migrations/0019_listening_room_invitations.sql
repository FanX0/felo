-- Migration: 0019_listening_room_invitations.sql
-- Table: listening_room_invitations for real-time room invitations from host to friends

create table if not exists public.listening_room_invitations (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.listening_rooms(id) on delete cascade,
  inviter_id uuid not null references auth.users(id) on delete cascade,
  invitee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (inviter_id <> invitee_id)
);

-- Partial unique index: at most one active pending invitation per room and invitee
create unique index if not exists room_invitations_room_invitee_pending_idx
  on public.listening_room_invitations(room_id, invitee_id)
  where (status = 'pending');

create index if not exists room_invitations_invitee_status_idx
  on public.listening_room_invitations(invitee_id, status, created_at desc);

create index if not exists room_invitations_inviter_idx
  on public.listening_room_invitations(inviter_id);

create index if not exists room_invitations_room_idx
  on public.listening_room_invitations(room_id);

-- Enable RLS
alter table public.listening_room_invitations enable row level security;

-- Read policy: Inviter or invitee can view the invitation
create policy "users can view their sent or received invitations"
  on public.listening_room_invitations for select
  to authenticated
  using ((select auth.uid()) = inviter_id or (select auth.uid()) = invitee_id);

-- Insert policy: Users can send invitations
create policy "users can send invitations"
  on public.listening_room_invitations for insert
  to authenticated
  with check ((select auth.uid()) = inviter_id and inviter_id <> invitee_id);

-- Update policy: Invitee can accept, decline or dismiss invitation
create policy "invitees can update invitation status"
  on public.listening_room_invitations for update
  to authenticated
  using ((select auth.uid()) = invitee_id)
  with check ((select auth.uid()) = invitee_id);

-- Delete policy: Inviter or invitee can delete
create policy "users can delete their invitations"
  on public.listening_room_invitations for delete
  to authenticated
  using ((select auth.uid()) = inviter_id or (select auth.uid()) = invitee_id);

-- Realtime publication
do $$ begin
  alter publication supabase_realtime add table public.listening_room_invitations;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
