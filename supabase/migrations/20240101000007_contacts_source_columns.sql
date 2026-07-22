-- ============================================================
-- Add source tracking columns to contacts table
-- Migration: 20240101000007_contacts_source_columns.sql
-- Fix: WA contacts should be deleted when their source session is deleted
-- ============================================================

-- Add source column: 'manual' (default) or 'wa_sync'
ALTER TABLE contacts
  ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'wa_sync'));

-- Add source_session_id: FK to wa_sessions, nullable
-- ON DELETE SET NULL so if session is deleted manually without going through
-- the edge function, the contact just loses its session reference
ALTER TABLE contacts
  ADD COLUMN source_session_id UUID
    REFERENCES wa_sessions(id) ON DELETE SET NULL;

-- Index for fast cascade-delete queries
CREATE INDEX idx_contacts_source_session ON contacts(source_session_id)
  WHERE source_session_id IS NOT NULL;

-- Constraint: manual contacts must NOT have a source_session_id
ALTER TABLE contacts
  ADD CONSTRAINT chk_contacts_manual_no_session
    CHECK (
      source != 'manual' OR source_session_id IS NULL
    );

COMMENT ON COLUMN contacts.source IS 'Origin of contact: manual (added by user) or wa_sync (synced from WhatsApp)';
COMMENT ON COLUMN contacts.source_session_id IS 'FK to wa_sessions.id for wa_sync contacts; NULL for manual contacts';
