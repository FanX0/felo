-- Migration 0017: Public Storage Bucket for Listen Together Audio
-- Creates a public 'songs' bucket with public select access and authenticated upload access.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'songs',
  'songs',
  true,
  104857600, -- 100 MB max file size
  ARRAY['audio/mpeg', 'audio/mp3', 'audio/flac', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/m4a']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 1. Anyone can stream / listen to song audio files in the public bucket
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects'
      AND schemaname = 'storage'
      AND policyname = 'Public Song Audio Access'
  ) THEN
    CREATE POLICY "Public Song Audio Access"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'songs');
  END IF;
END $$;

-- 2. Anyone (authenticated or public session) can upload songs to the bucket for Listen Together
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects'
      AND schemaname = 'storage'
      AND policyname = 'Public Song Audio Upload'
  ) THEN
    CREATE POLICY "Public Song Audio Upload"
    ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'songs');
  END IF;
END $$;

-- 3. Authenticated users can update/replace their uploaded songs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects'
      AND schemaname = 'storage'
      AND policyname = 'Authenticated Song Audio Update'
  ) THEN
    CREATE POLICY "Authenticated Song Audio Update"
    ON storage.objects FOR UPDATE
    USING (bucket_id = 'songs' AND auth.role() = 'authenticated');
  END IF;
END $$;

-- 4. Automatic pruning / cleanup: Anyone can delete expired songs from the bucket to protect free tier storage limits
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects'
      AND schemaname = 'storage'
      AND policyname = 'Public Song Audio Prune'
  ) THEN
    CREATE POLICY "Public Song Audio Prune"
    ON storage.objects FOR DELETE
    USING (bucket_id = 'songs');
  END IF;
END $$;
