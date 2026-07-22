-- ============================================================
-- Migration: 20240101000006_broadcast_rpc_helpers.sql
-- RPC helper functions for atomic broadcast counter increments.
-- Called by the webhooks Edge Function after each delivery callback.
-- ============================================================

-- Atomically increment sent_count and advance last_sent_index
CREATE OR REPLACE FUNCTION increment_broadcast_sent(p_broadcast_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE broadcast_jobs
  SET
    sent_count       = sent_count + 1,
    last_sent_index  = last_sent_index + 1,
    updated_at       = now()
  WHERE id = p_broadcast_id;
END;
$$;

-- Atomically increment failed_count and advance last_sent_index
CREATE OR REPLACE FUNCTION increment_broadcast_failed(p_broadcast_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE broadcast_jobs
  SET
    failed_count     = failed_count + 1,
    last_sent_index  = last_sent_index + 1,
    updated_at       = now()
  WHERE id = p_broadcast_id;
END;
$$;

-- Add unique constraint on message_logs(broadcast_id, contact_id) so upsert works
-- Only add if it doesn't exist yet
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_message_logs_broadcast_contact'
  ) THEN
    ALTER TABLE message_logs
      ADD CONSTRAINT uq_message_logs_broadcast_contact
      UNIQUE (broadcast_id, contact_id);
  END IF;
END;
$$;
