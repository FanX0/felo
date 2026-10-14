-- Migration: 0010_user_devices.sql
-- Enables cross-device discovery, heartbeat presence, and remote playback control (Spotify Connect style)

CREATE TABLE IF NOT EXISTS public.user_devices (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_name TEXT NOT NULL,
  device_type TEXT NOT NULL DEFAULT 'desktop',
  local_ip TEXT,
  port INTEGER DEFAULT 4788,
  token TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for quick lookup by user and active status
CREATE INDEX IF NOT EXISTS idx_user_devices_user_active
  ON public.user_devices(user_id, is_active, last_seen_at DESC);

-- Enable Row Level Security
ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;

-- 1. Users can view their own devices
DROP POLICY IF EXISTS "Users can view own devices" ON public.user_devices;
CREATE POLICY "Users can view own devices"
  ON public.user_devices
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- 2. Users can insert their own devices
DROP POLICY IF EXISTS "Users can insert own devices" ON public.user_devices;
CREATE POLICY "Users can insert own devices"
  ON public.user_devices
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- 3. Users can update their own devices
DROP POLICY IF EXISTS "Users can update own devices" ON public.user_devices;
CREATE POLICY "Users can update own devices"
  ON public.user_devices
  FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- 4. Users can delete their own devices
DROP POLICY IF EXISTS "Users can delete own devices" ON public.user_devices;
CREATE POLICY "Users can delete own devices"
  ON public.user_devices
  FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- Ensure full replica identity for realtime postgres_changes filters
ALTER TABLE public.user_devices REPLICA IDENTITY FULL;

-- Add table to Realtime publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'user_devices'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_devices;
  END IF;
END $$;
