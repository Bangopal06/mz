-- Migration: 20240101000011_enable_realtime_chat.sql
-- Enable Supabase Realtime for chat_messages table
-- Required for ChatClient realtime subscription (Requirement 8.1)

-- Add chat_messages to the supabase_realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;

-- Set REPLICA IDENTITY to FULL so UPDATE/DELETE payloads include old row data
ALTER TABLE chat_messages REPLICA IDENTITY FULL;
