-- Migration: 20240101000013_cascade_delete_contacts.sql
-- Auto-delete wa_sync contacts when their source session is deleted
-- Fixes the case where session is deleted directly from DB (bypassing API)

-- Drop the SET NULL constraint first, replace with CASCADE delete for wa_sync contacts
-- We can't use ON DELETE CASCADE directly on FK because manual contacts also reference wa_sessions
-- Instead, use a trigger

CREATE OR REPLACE FUNCTION delete_wa_sync_contacts_on_session_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- Only delete wa_sync contacts not referenced in any broadcast
  DELETE FROM contacts
  WHERE source = 'wa_sync'
    AND source_session_id = OLD.id
    AND id NOT IN (SELECT contact_id FROM broadcast_recipients);
  
  -- For contacts still in broadcasts, just clear the session reference
  UPDATE contacts
  SET source_session_id = NULL
  WHERE source = 'wa_sync'
    AND source_session_id = OLD.id;
    
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_delete_wa_sync_contacts ON wa_sessions;

CREATE TRIGGER trg_delete_wa_sync_contacts
  BEFORE DELETE ON wa_sessions
  FOR EACH ROW
  EXECUTE FUNCTION delete_wa_sync_contacts_on_session_delete();
