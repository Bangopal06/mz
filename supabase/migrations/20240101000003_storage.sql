-- Insert bucket ke storage.buckets (Supabase Storage)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'media-attachments',
  'media-attachments',
  false,  -- private bucket, akses via signed URL
  16777216,  -- 16MB = 16 * 1024 * 1024 bytes
  ARRAY[
    'image/jpeg', 'image/png', 'image/jpg',
    'video/mp4',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
);

-- Storage RLS policies
-- Only authenticated users can upload
CREATE POLICY "authenticated_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'media-attachments'
    AND is_active_user()
    AND get_user_role() IN ('owner', 'admin')
  );

-- Authenticated users can read (for previews)
CREATE POLICY "authenticated_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'media-attachments'
    AND is_active_user()
  );

-- Owner + Admin can delete
CREATE POLICY "owner_admin_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'media-attachments'
    AND get_user_role() IN ('owner', 'admin')
    AND is_active_user()
  );
