-- Migration: 0018_listening_room_speaker_roles.sql
-- Add speaker role assignment per device in listening rooms
-- Enables MUSIXQUARE-style distributed wireless multi-speaker system

-- 1. Add speaker_role and sub_cutoff columns
ALTER TABLE public.listening_room_members
ADD COLUMN IF NOT EXISTS speaker_role text NOT NULL DEFAULT 'center',
ADD COLUMN IF NOT EXISTS sub_cutoff integer NOT NULL DEFAULT 120;

-- 2. Add constraint for valid speaker roles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'listening_room_members_speaker_role_check'
  ) THEN
    ALTER TABLE public.listening_room_members
    ADD CONSTRAINT listening_room_members_speaker_role_check
    CHECK (speaker_role IN ('center', 'left', 'right', 'subwoofer'));
  END IF;
END
$$;

-- 2b. Add RLS policy for updating own room membership (required for upsert / speaker role update)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'listening_room_members' AND policyname = 'users can update own room membership'
  ) THEN
    CREATE POLICY "users can update own room membership" 
    ON public.listening_room_members
    FOR UPDATE TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
  END IF;
END
$$;

-- 3. RPC: Set own speaker role (any room member can choose their device role)
CREATE OR REPLACE FUNCTION public.set_my_speaker_role(
  target_room_id uuid,
  new_speaker_role text,
  new_sub_cutoff integer DEFAULT 120
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid;
BEGIN
  caller_id := auth.uid();
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF new_speaker_role NOT IN ('center', 'left', 'right', 'subwoofer') THEN
    RAISE EXCEPTION 'Invalid speaker role. Must be center, left, right, or subwoofer.';
  END IF;

  UPDATE public.listening_room_members
  SET speaker_role = new_speaker_role,
      sub_cutoff = COALESCE(new_sub_cutoff, 120)
  WHERE room_id = target_room_id AND user_id = caller_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You are not a member of this room.';
  END IF;
END;
$$;

-- 4. RPC: Set a member's speaker role (host can orchestrate speaker placement)
CREATE OR REPLACE FUNCTION public.set_room_member_speaker_role(
  target_room_id uuid,
  target_user_id uuid,
  new_speaker_role text,
  new_sub_cutoff integer DEFAULT 120
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
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT host_id INTO room_host_id
  FROM public.listening_rooms
  WHERE id = target_room_id AND is_active = true;

  IF room_host_id IS NULL THEN
    RAISE EXCEPTION 'Room not found or inactive.';
  END IF;

  IF room_host_id != caller_id AND target_user_id != caller_id THEN
    RAISE EXCEPTION 'Only the host or member themselves can change speaker role.';
  END IF;

  IF new_speaker_role NOT IN ('center', 'left', 'right', 'subwoofer') THEN
    RAISE EXCEPTION 'Invalid speaker role. Must be center, left, right, or subwoofer.';
  END IF;

  UPDATE public.listening_room_members
  SET speaker_role = new_speaker_role,
      sub_cutoff = COALESCE(new_sub_cutoff, 120)
  WHERE room_id = target_room_id AND user_id = target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found in this room.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_speaker_role(uuid, text, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.set_my_speaker_role(uuid, text, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.set_room_member_speaker_role(uuid, uuid, text, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.set_room_member_speaker_role(uuid, uuid, text, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
