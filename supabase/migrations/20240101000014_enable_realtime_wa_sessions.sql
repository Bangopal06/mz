-- Migration: 20240101000014_enable_realtime_wa_sessions.sql
-- Enable Supabase Realtime for wa_sessions table
-- Required for SessionsClient real-time status updates (no page refresh needed)

-- Add wa_sessions to the supabase_realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE wa_sessions;

-- Set REPLICA IDENTITY to FULL so UPDATE payloads include old row data
-- This is needed so the client can match which row changed
ALTER TABLE wa_sessions REPLICA IDENTITY FULL;
