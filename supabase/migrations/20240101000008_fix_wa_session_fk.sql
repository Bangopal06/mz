-- ============================================================
-- Fix FK constraint: allow wa_sessions to be deleted even when
-- broadcast_jobs still reference them.
-- Migration: 20240101000008_fix_wa_session_fk.sql
-- ============================================================

-- Drop the existing FK constraint
ALTER TABLE broadcast_jobs
  DROP CONSTRAINT IF EXISTS broadcast_jobs_wa_session_id_fkey;

-- Re-add with ON DELETE SET NULL so deleting a session
-- just nulls the reference in broadcast_jobs
ALTER TABLE broadcast_jobs
  ALTER COLUMN wa_session_id DROP NOT NULL;

ALTER TABLE broadcast_jobs
  ADD CONSTRAINT broadcast_jobs_wa_session_id_fkey
    FOREIGN KEY (wa_session_id)
    REFERENCES wa_sessions(id)
    ON DELETE SET NULL;

-- Also fix keyword_rules FK to wa_sessions
ALTER TABLE keyword_rules
  DROP CONSTRAINT IF EXISTS keyword_rules_wa_session_id_fkey;

ALTER TABLE keyword_rules
  ADD CONSTRAINT keyword_rules_wa_session_id_fkey
    FOREIGN KEY (wa_session_id)
    REFERENCES wa_sessions(id)
    ON DELETE SET NULL;

-- Also fix greeted_contacts FK to wa_sessions
ALTER TABLE greeted_contacts
  DROP CONSTRAINT IF EXISTS greeted_contacts_session_id_fkey;

ALTER TABLE greeted_contacts
  ADD CONSTRAINT greeted_contacts_session_id_fkey
    FOREIGN KEY (session_id)
    REFERENCES wa_sessions(id)
    ON DELETE CASCADE;
