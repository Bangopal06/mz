-- ============================================================
-- WhatsApp Broadcast CRM — Initial Schema Migration
-- Migration: 20240101000001_initial_schema.sql
-- Requirements: 2.1, 3.1, 5.1, 6.1, 7.1, 8.1, 10.1, 11.1, 12.1
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- TABLE 1: users
-- Stores application users with role-based access control
-- ============================================================
CREATE TABLE users (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email        TEXT UNIQUE NOT NULL,
    full_name    TEXT NOT NULL,
    role         TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'staff', 'operator')),
    is_active    BOOLEAN NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- FK to Supabase auth.users
    auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE
);

COMMENT ON TABLE users IS 'Application users with role-based access control';
COMMENT ON COLUMN users.role IS 'User role: owner (full access), admin (operational), staff (broadcast only), operator (read-only contacts)';

-- ============================================================
-- TABLE 2: contacts
-- Stores WhatsApp contacts for broadcast targeting
-- ============================================================
CREATE TABLE contacts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name   TEXT NOT NULL,
    wa_number   TEXT UNIQUE NOT NULL,  -- format: 628xxxxxxxxxx
    category    TEXT,
    status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    notes       TEXT,
    joined_at   DATE NOT NULL DEFAULT CURRENT_DATE,
    created_by  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE contacts IS 'WhatsApp contacts for broadcast targeting';
COMMENT ON COLUMN contacts.wa_number IS 'WhatsApp number in international format: 628xxxxxxxxxx';

CREATE INDEX idx_contacts_wa_number ON contacts(wa_number);
CREATE INDEX idx_contacts_status ON contacts(status);

-- ============================================================
-- TABLE 3: contact_groups
-- Groups for organizing contacts into segments
-- ============================================================
CREATE TABLE contact_groups (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    description TEXT,
    created_by  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE contact_groups IS 'Groups for organizing contacts into segments';

-- ============================================================
-- TABLE 4: contact_group_members
-- Many-to-many relationship between contacts and groups
-- ============================================================
CREATE TABLE contact_group_members (
    contact_id  UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    group_id    UUID NOT NULL REFERENCES contact_groups(id) ON DELETE CASCADE,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (contact_id, group_id)
);

COMMENT ON TABLE contact_group_members IS 'Many-to-many relationship: contacts can belong to multiple groups';

-- ============================================================
-- TABLE 5: media_attachments
-- Media files uploaded for use in broadcast messages
-- ============================================================
CREATE TABLE media_attachments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    storage_path    TEXT NOT NULL,        -- path in Supabase Storage bucket
    original_name   TEXT NOT NULL,
    mime_type       TEXT NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    caption         TEXT,
    uploaded_by     UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE media_attachments IS 'Media files (images, video, PDF, documents) for broadcast messages';
COMMENT ON COLUMN media_attachments.storage_path IS 'Path within Supabase Storage bucket media-attachments';

-- ============================================================
-- TABLE 6: message_templates
-- Reusable message templates with variable support
-- ============================================================
CREATE TABLE message_templates (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title         TEXT NOT NULL,
    body          TEXT NOT NULL,   -- supports {{nama}}, {{nomor}}, custom variables
    attachment_id UUID REFERENCES media_attachments(id),
    created_by    UUID REFERENCES users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE message_templates IS 'Reusable message templates with {{variable}} personalization support';

-- ============================================================
-- TABLE 7: wa_sessions
-- WhatsApp session connections managed via gateway service
-- ============================================================
CREATE TABLE wa_sessions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_key    TEXT UNIQUE NOT NULL,  -- identifier in gateway service
    phone_number   TEXT,
    display_name   TEXT,
    status         TEXT NOT NULL DEFAULT 'disconnected'
                       CHECK (status IN ('connected', 'disconnected', 'expired', 'pairing')),
    last_active_at TIMESTAMPTZ,
    expires_at     TIMESTAMPTZ,            -- 30 days of inactivity
    owner_id       UUID REFERENCES users(id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE wa_sessions IS 'WhatsApp session connections; expires after 30 days of inactivity';
COMMENT ON COLUMN wa_sessions.session_key IS 'Unique identifier used by the gateway service to identify the session';
COMMENT ON COLUMN wa_sessions.expires_at IS 'Computed as last_active_at + 30 days; session is marked expired when now() > expires_at';

-- ============================================================
-- TABLE 8: broadcast_jobs
-- Broadcast message jobs with scheduling and progress tracking
-- ============================================================
CREATE TABLE broadcast_jobs (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title             TEXT NOT NULL,
    message_body      TEXT NOT NULL,    -- resolved message body or raw template
    template_id       UUID REFERENCES message_templates(id),
    attachment_id     UUID REFERENCES media_attachments(id),
    wa_session_id     UUID NOT NULL REFERENCES wa_sessions(id),
    status            TEXT NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled', 'failed')),
    recipient_type    TEXT NOT NULL CHECK (recipient_type IN ('all', 'group', 'manual')),
    scheduled_at      TIMESTAMPTZ,      -- NULL = immediate
    started_at        TIMESTAMPTZ,
    completed_at      TIMESTAMPTZ,
    last_sent_index   INTEGER NOT NULL DEFAULT 0,   -- resume position after interruption
    total_recipients  INTEGER NOT NULL DEFAULT 0,
    sent_count        INTEGER NOT NULL DEFAULT 0,
    failed_count      INTEGER NOT NULL DEFAULT 0,
    rate_limit_min_ms INTEGER NOT NULL DEFAULT 3000,
    rate_limit_max_ms INTEGER NOT NULL DEFAULT 10000,
    created_by        UUID REFERENCES users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE broadcast_jobs IS 'Broadcast jobs with rate limiting, scheduling, and resume support';
COMMENT ON COLUMN broadcast_jobs.last_sent_index IS 'Last successfully sent recipient index; used for resume after interruption';
COMMENT ON COLUMN broadcast_jobs.rate_limit_min_ms IS 'Minimum delay between messages in milliseconds (default 3000)';
COMMENT ON COLUMN broadcast_jobs.rate_limit_max_ms IS 'Maximum delay between messages in milliseconds (default 10000)';

CREATE INDEX idx_broadcast_jobs_status ON broadcast_jobs(status);
CREATE INDEX idx_broadcast_jobs_scheduled ON broadcast_jobs(scheduled_at) WHERE status = 'scheduled';

-- ============================================================
-- TABLE 9: broadcast_recipients
-- Individual recipients for each broadcast job
-- ============================================================
CREATE TABLE broadcast_recipients (
    id           UUID NOT NULL DEFAULT gen_random_uuid(),
    broadcast_id UUID NOT NULL REFERENCES broadcast_jobs(id) ON DELETE CASCADE,
    contact_id   UUID NOT NULL REFERENCES contacts(id),
    send_order   INTEGER NOT NULL,       -- ordering for sequential delivery
    PRIMARY KEY (broadcast_id, contact_id)
);

COMMENT ON TABLE broadcast_recipients IS 'Recipients list per broadcast job with ordered delivery sequence';
COMMENT ON COLUMN broadcast_recipients.send_order IS 'Sequential delivery order; used with last_sent_index for resume';

-- ============================================================
-- TABLE 10: message_logs
-- Per-message delivery status log for each broadcast recipient
-- ============================================================
CREATE TABLE message_logs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    broadcast_id  UUID NOT NULL REFERENCES broadcast_jobs(id),
    contact_id    UUID NOT NULL REFERENCES contacts(id),
    wa_number     TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed')),
    error_code    TEXT,
    error_message TEXT,
    sent_at       TIMESTAMPTZ,
    delivered_at  TIMESTAMPTZ,
    read_at       TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE message_logs IS 'Per-message delivery status log; updated via gateway webhook callbacks';
COMMENT ON COLUMN message_logs.error_code IS 'Gateway error code if delivery failed (e.g. WA_DISCONNECTED, MSG_INVALID_NUMBER)';

CREATE INDEX idx_message_logs_broadcast ON message_logs(broadcast_id);
CREATE INDEX idx_message_logs_status ON message_logs(status);
CREATE INDEX idx_message_logs_created ON message_logs(created_at);

-- ============================================================
-- TABLE 11: keyword_rules
-- Auto-reply rules triggered by incoming message keywords
-- ============================================================
CREATE TABLE keyword_rules (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,
    response_text TEXT NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT true,
    is_greeting   BOOLEAN NOT NULL DEFAULT false,  -- one-time greeting per contact per session
    wa_session_id UUID REFERENCES wa_sessions(id),
    created_by    UUID REFERENCES users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE keyword_rules IS 'Auto-reply rules; when is_greeting=true, sent only once per contact per session';
COMMENT ON COLUMN keyword_rules.is_greeting IS 'If true, this response is sent only once per contact per session (tracked in greeted_contacts)';

-- ============================================================
-- TABLE 12: keyword_triggers
-- Individual keywords that trigger a keyword rule
-- ============================================================
CREATE TABLE keyword_triggers (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id    UUID NOT NULL REFERENCES keyword_rules(id) ON DELETE CASCADE,
    keyword    TEXT NOT NULL,  -- stored lowercase for case-insensitive matching
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE keyword_triggers IS 'Keywords that trigger an auto-reply rule; stored lowercase for case-insensitive matching';

CREATE INDEX idx_keyword_triggers_keyword ON keyword_triggers(keyword);

-- ============================================================
-- TABLE 13: greeted_contacts
-- Tracks contacts who have already received a greeting message
-- ============================================================
CREATE TABLE greeted_contacts (
    contact_wa_number TEXT NOT NULL,
    session_id        UUID NOT NULL REFERENCES wa_sessions(id),
    greeted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (contact_wa_number, session_id)
);

COMMENT ON TABLE greeted_contacts IS 'Tracks per-session greeting delivery to prevent duplicate greetings';
COMMENT ON COLUMN greeted_contacts.contact_wa_number IS 'WhatsApp number of the greeted contact';

-- ============================================================
-- TABLE 14: activity_logs
-- Audit trail of all important system actions
-- ============================================================
CREATE TABLE activity_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id),
    action      TEXT NOT NULL,    -- e.g. 'broadcast.create', 'contact.delete', 'user.login'
    entity_type TEXT,             -- e.g. 'broadcast', 'contact', 'user'
    entity_id   TEXT,
    detail      JSONB,
    ip_address  INET,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE activity_logs IS 'Audit trail; retained for 90 days via scheduled cleanup Edge Function';
COMMENT ON COLUMN activity_logs.action IS 'Action identifier: login, broadcast.create, contact.delete, user.role_change, error.send, auto_reply.sent';
COMMENT ON COLUMN activity_logs.detail IS 'JSON payload with action-specific details (error codes, old/new values, etc.)';

CREATE INDEX idx_activity_logs_user ON activity_logs(user_id);
CREATE INDEX idx_activity_logs_created ON activity_logs(created_at);

-- ============================================================
-- TABLE 15: failed_login_attempts
-- Rate limiting for login brute-force protection
-- ============================================================
CREATE TABLE failed_login_attempts (
    email      TEXT NOT NULL,
    attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ip_address INET
);

COMMENT ON TABLE failed_login_attempts IS 'Tracks failed login attempts; 5+ attempts in 15 minutes locks the account';
COMMENT ON COLUMN failed_login_attempts.email IS 'Email address that was used in the failed login attempt';

CREATE INDEX idx_failed_logins_email_time ON failed_login_attempts(email, attempt_at);

-- ============================================================
-- TRIGGERS: auto-update updated_at columns
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_contacts_updated_at
    BEFORE UPDATE ON contacts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_contact_groups_updated_at
    BEFORE UPDATE ON contact_groups
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_message_templates_updated_at
    BEFORE UPDATE ON message_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_wa_sessions_updated_at
    BEFORE UPDATE ON wa_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_broadcast_jobs_updated_at
    BEFORE UPDATE ON broadcast_jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_keyword_rules_updated_at
    BEFORE UPDATE ON keyword_rules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
