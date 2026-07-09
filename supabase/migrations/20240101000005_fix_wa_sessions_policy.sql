-- Fix: allow authenticated users to update their own wa_sessions status
-- This is needed when the gateway webhook is not deployed yet

-- Allow any authenticated active user to update wa_sessions status
-- (the gateway webhook will handle this properly in production)
CREATE POLICY "wa_sessions_authenticated_update" ON wa_sessions
  FOR UPDATE TO authenticated
  USING (is_active_user())
  WITH CHECK (is_active_user());
