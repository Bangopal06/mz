-- Migration: 20240101000010_chat_media_bucket.sql
-- Creates the chat-media Supabase Storage bucket for WhatsApp Chat Inbox
-- Requirements: 7.5, 2.5

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-media',
  'chat-media',
  true,           -- public bucket: media_url can be served directly
  5242880,        -- 5 MB = 5 * 1024 * 1024 bytes (enforced at frontend too)
  ARRAY[
    'image/jpeg',
    'image/png'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to chat-media bucket
CREATE POLICY "chat_media_authenticated_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-media'
  );

-- Allow service_role to upload (for Gateway uploads)
CREATE POLICY "chat_media_service_role_upload" ON storage.objects
  FOR INSERT TO service_role
  WITH CHECK (
    bucket_id = 'chat-media'
  );

-- Public read for chat-media (bucket is public, but RLS still applies)
CREATE POLICY "chat_media_public_read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'chat-media'
  );
