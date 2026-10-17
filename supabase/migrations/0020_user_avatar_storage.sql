-- Migration 0020: Public Storage Bucket for User Profile Avatars
-- Creates a public 'avatars' bucket with public read access and user-scoped upload/update/delete access.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  5242880, -- 5 MB max file size
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 1. Public Read Policy: Anyone can view user profile avatars
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects'
      AND schemaname = 'storage'
      AND policyname = 'Public Avatar Access'
  ) THEN
    CREATE POLICY "Public Avatar Access"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'avatars');
  END IF;
END $$;

-- 2. Authenticated Upload Policy: Authenticated users can upload to their own user-scoped directory
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects'
      AND schemaname = 'storage'
      AND policyname = 'Authenticated User Avatar Upload'
  ) THEN
    CREATE POLICY "Authenticated User Avatar Upload"
    ON storage.objects FOR INSERT
    WITH CHECK (
      bucket_id = 'avatars'
      AND auth.role() = 'authenticated'
      AND (storage.foldername(name))[1] = auth.uid()::text
    );
  END IF;
END $$;

-- 3. Authenticated Update Policy: Authenticated users can update/replace their own avatars
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects'
      AND schemaname = 'storage'
      AND policyname = 'Authenticated User Avatar Update'
  ) THEN
    CREATE POLICY "Authenticated User Avatar Update"
    ON storage.objects FOR UPDATE
    USING (
      bucket_id = 'avatars'
      AND auth.role() = 'authenticated'
      AND (storage.foldername(name))[1] = auth.uid()::text
    );
  END IF;
END $$;

-- 4. Authenticated Delete Policy: Authenticated users can delete their own avatars
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects'
      AND schemaname = 'storage'
      AND policyname = 'Authenticated User Avatar Delete'
  ) THEN
    CREATE POLICY "Authenticated User Avatar Delete"
    ON storage.objects FOR DELETE
    USING (
      bucket_id = 'avatars'
      AND auth.role() = 'authenticated'
      AND (storage.foldername(name))[1] = auth.uid()::text
    );
  END IF;
END $$;
