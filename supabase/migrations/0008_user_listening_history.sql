-- 0008_user_listening_history.sql
-- Listening history events, profile privacy, and aggregated statistics for personalized listening.

-- 1. Extend profiles with listening history privacy setting
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_history_public BOOLEAN NOT NULL DEFAULT true;

-- 2. Create user_play_events table
CREATE TABLE IF NOT EXISTS public.user_play_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  track_title TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  album_name TEXT,
  artwork_url TEXT,
  duration INTEGER DEFAULT 0,
  completed_percent REAL DEFAULT 1.0,
  context_type TEXT DEFAULT 'library',
  source TEXT DEFAULT 'local',
  played_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for efficient timeline and artist queries
CREATE INDEX IF NOT EXISTS idx_user_play_events_user_time ON public.user_play_events(user_id, played_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_play_events_artist ON public.user_play_events(user_id, artist_name);

-- 3. Enable Row Level Security
ALTER TABLE public.user_play_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert own play events" ON public.user_play_events;
CREATE POLICY "Users can insert own play events"
  ON public.user_play_events FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete own play events" ON public.user_play_events;
CREATE POLICY "Users can delete own play events"
  ON public.user_play_events FOR DELETE
  TO authenticated
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Anyone can view play events of public profiles" ON public.user_play_events;
CREATE POLICY "Anyone can view play events of public profiles"
  ON public.user_play_events FOR SELECT
  TO authenticated, anon
  USING (
    (select auth.uid()) = user_id OR
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = user_play_events.user_id AND profiles.is_history_public = true
    )
  );

-- Grant table permissions to standard roles
GRANT SELECT, INSERT, DELETE ON public.user_play_events TO authenticated;
GRANT SELECT ON public.user_play_events TO anon;

-- 4. Fast Server-Side Aggregation for User Listening Stats
CREATE OR REPLACE FUNCTION public.get_user_listening_stats(
  target_user_id UUID,
  since_timestamp TIMESTAMPTZ DEFAULT (now() - interval '30 days')
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB;
BEGIN
  -- Verify permission: requester is the user, or target has is_history_public
  IF auth.uid() <> target_user_id THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = target_user_id AND is_history_public = true
    ) THEN
      RETURN jsonb_build_object(
        'total_plays', 0,
        'unique_tracks', 0,
        'top_artists', '[]'::jsonb,
        'top_tracks', '[]'::jsonb
      );
    END IF;
  END IF;

  SELECT jsonb_build_object(
    'total_plays', COALESCE(COUNT(*), 0),
    'unique_tracks', COALESCE(COUNT(DISTINCT lower(track_title) || ':::' || lower(artist_name)), 0),
    'top_artists', COALESCE((
      SELECT jsonb_agg(sub)
      FROM (
        SELECT artist_name AS artist, COUNT(*) AS play_count
        FROM public.user_play_events
        WHERE user_id = target_user_id AND played_at >= since_timestamp
        GROUP BY artist_name
        ORDER BY play_count DESC
        LIMIT 15
      ) sub
    ), '[]'::jsonb),
    'top_tracks', COALESCE((
      SELECT jsonb_agg(sub)
      FROM (
        SELECT track_title AS title, artist_name AS artist, album_name AS album,
               artwork_url AS artwork, COUNT(*) AS play_count
        FROM public.user_play_events
        WHERE user_id = target_user_id AND played_at >= since_timestamp
        GROUP BY track_title, artist_name, album_name, artwork_url
        ORDER BY play_count DESC
        LIMIT 30
      ) sub
    ), '[]'::jsonb)
  ) INTO result
  FROM public.user_play_events
  WHERE user_id = target_user_id AND played_at >= since_timestamp;

  RETURN COALESCE(result, '{}'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_listening_stats(UUID, TIMESTAMPTZ) TO authenticated, anon;
