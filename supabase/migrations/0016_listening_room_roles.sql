-- Migration: 0016_listening_room_roles.sql
-- Add role-based permissions to listening room members (Host, Co-host, Listener)

-- 1. Add role column with default 'listener'
ALTER TABLE public.listening_room_members
ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'listener';

-- 2. Add constraint for valid roles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'listening_room_members_role_check'
  ) THEN
    ALTER TABLE public.listening_room_members
    ADD CONSTRAINT listening_room_members_role_check
    CHECK (role IN ('host', 'co_host', 'listener'));
  END IF;
END
$$;

-- 3. Backfill: Set existing host_id members to 'host' role
UPDATE public.listening_room_members m
SET role = 'host'
FROM public.listening_rooms r
WHERE m.room_id = r.id
  AND m.user_id = r.host_id
  AND m.role = 'listener';

-- 4. RPC: Set a member's role (only callable by the room host)
CREATE OR REPLACE FUNCTION public.set_room_member_role(
  target_room_id uuid,
  target_user_id uuid,
  new_role text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid;
  room_host_id uuid;
BEGIN
  caller_id := auth.uid();

  SELECT host_id INTO room_host_id
  FROM listening_rooms
  WHERE id = target_room_id AND is_active = true;

  IF room_host_id IS NULL THEN
    RAISE EXCEPTION 'Room not found or inactive.';
  END IF;

  IF room_host_id != caller_id THEN
    RAISE EXCEPTION 'Only the host can change member roles.';
  END IF;

  IF new_role NOT IN ('co_host', 'listener') THEN
    RAISE EXCEPTION 'Invalid role. Must be co_host or listener.';
  END IF;

  -- Prevent changing own role (host cannot demote self)
  IF target_user_id = caller_id THEN
    RAISE EXCEPTION 'Cannot change your own role. Use host transfer instead.';
  END IF;

  UPDATE listening_room_members
  SET role = new_role
  WHERE room_id = target_room_id AND user_id = target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found in this room.';
  END IF;
END;
$$;

-- 5. RPC: Kick a member from the room (only callable by the room host)
CREATE OR REPLACE FUNCTION public.kick_room_member(
  target_room_id uuid,
  target_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid;
  room_host_id uuid;
BEGIN
  caller_id := auth.uid();

  SELECT host_id INTO room_host_id
  FROM listening_rooms
  WHERE id = target_room_id AND is_active = true;

  IF room_host_id IS NULL THEN
    RAISE EXCEPTION 'Room not found or inactive.';
  END IF;

  IF room_host_id != caller_id THEN
    RAISE EXCEPTION 'Only the host can kick members.';
  END IF;

  IF target_user_id = caller_id THEN
    RAISE EXCEPTION 'Cannot kick yourself. Use stop room instead.';
  END IF;

  DELETE FROM listening_room_members
  WHERE room_id = target_room_id AND user_id = target_user_id;
END;
$$;

-- 6. Enable realtime on listening_room_members for role change notifications
ALTER TABLE public.listening_room_members REPLICA IDENTITY FULL;
