-- ============================================================
-- WhatsApp Broadcast CRM — Row-Level Security Policies
-- Migration: 20240101000002_rls_policies.sql
-- Requirements: 9.6, 9.7
-- ============================================================
-- Permission Matrix:
-- | Table                  | Owner | Admin     | Staff     | Operator  |
-- |------------------------|-------|-----------|-----------|-----------|
-- | users                  | CRUD  | Read self | Read self | Read self |
-- | contacts               | CRUD  | CRUD      | Read      | Read      |
-- | contact_groups         | CRUD  | CRUD      | Read      | Read      |
-- | contact_group_members  | CRUD  | CRUD      | Read      | Read      |
-- | broadcast_jobs         | CRUD  | CRUD      | CRUD      | —         |
-- | broadcast_recipients   | CRUD  | CRUD      | CRUD      | —         |
-- | message_logs           | CRUD  | Read      | Read      | —         |
-- | message_templates      | CRUD  | CRUD      | Read      | —         |
-- | media_attachments      | CRUD  | CRUD      | Read      | —         |
-- | keyword_rules          | CRUD  | CRUD      | Read      | —         |
-- | keyword_triggers       | CRUD  | CRUD      | Read      | —         |
-- | greeted_contacts       | CRUD  | CRUD      | Read      | —         |
-- | wa_sessions            | CRUD  | Read      | Read      | —         |
-- | activity_logs          | Read  | Read      | —         | —         |
-- | failed_login_attempts  | CRUD  | —         | —         | —         |
-- ============================================================

-- ============================================================
-- HELPER FUNCTIONS
-- These functions are called within RLS policies to check
-- the current user's role and active status. SECURITY DEFINER
-- ensures they run with the privileges of the function owner,
-- bypassing RLS on the users table itself.
-- ============================================================

CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
  SELECT role FROM users WHERE auth_user_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_active_user()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT is_active FROM users WHERE auth_user_id = auth.uid()),
    false
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE;

COMMENT ON FUNCTION get_user_role() IS 'Returns the role of the currently authenticated user. Used in RLS policies.';
COMMENT ON FUNCTION is_active_user() IS 'Returns true if the currently authenticated user is active. Used in RLS policies.';

-- ============================================================
-- TABLE: users
-- Policy: Owner has full CRUD on all rows.
-- All other roles can only SELECT their own row (auth_user_id = auth.uid()).
-- No non-owner can INSERT, UPDATE, or DELETE user rows directly.
-- ============================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Owner: full CRUD on all rows
CREATE POLICY "users_owner_all" ON users
  FOR ALL TO authenticated
  USING (get_user_role() = 'owner' AND is_active_user())
  WITH CHECK (get_user_role() = 'owner' AND is_active_user());

-- Admin, Staff, Operator: can only read their own row
CREATE POLICY "users_self_read" ON users
  FOR SELECT TO authenticated
  USING (
    auth_user_id = auth.uid()
    AND is_active_user()
    AND get_user_role() IN ('admin', 'staff', 'operator')
  );

-- ============================================================
-- TABLE: contacts
-- Policy: Owner and Admin have full CRUD.
-- Staff and Operator can only SELECT.
-- ============================================================

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

-- Owner + Admin: full CRUD
CREATE POLICY "contacts_owner_admin_all" ON contacts
  FOR ALL TO authenticated
  USING (get_user_role() IN ('owner', 'admin') AND is_active_user())
  WITH CHECK (get_user_role() IN ('owner', 'admin') AND is_active_user());

-- Staff + Operator: read only
CREATE POLICY "contacts_staff_operator_read" ON contacts
  FOR SELECT TO authenticated
  USING (
    get_user_role() IN ('staff', 'operator')
    AND is_active_user()
  );

-- ============================================================
-- TABLE: contact_groups
-- Policy: Owner and Admin have full CRUD.
-- Staff and Operator can only SELECT.
-- ============================================================

ALTER TABLE contact_groups ENABLE ROW LEVEL SECURITY;

-- Owner + Admin: full CRUD
CREATE POLICY "contact_groups_owner_admin_all" ON contact_groups
  FOR ALL TO authenticated
  USING (get_user_role() IN ('owner', 'admin') AND is_active_user())
  WITH CHECK (get_user_role() IN ('owner', 'admin') AND is_active_user());

-- Staff + Operator: read only
CREATE POLICY "contact_groups_staff_operator_read" ON contact_groups
  FOR SELECT TO authenticated
  USING (
    get_user_role() IN ('staff', 'operator')
    AND is_active_user()
  );

-- ============================================================
-- TABLE: contact_group_members
-- Policy: Owner and Admin have full CRUD.
-- Staff and Operator can only SELECT.
-- ============================================================

ALTER TABLE contact_group_members ENABLE ROW LEVEL SECURITY;

-- Owner + Admin: full CRUD
CREATE POLICY "contact_group_members_owner_admin_all" ON contact_group_members
  FOR ALL TO authenticated
  USING (get_user_role() IN ('owner', 'admin') AND is_active_user())
  WITH CHECK (get_user_role() IN ('owner', 'admin') AND is_active_user());

-- Staff + Operator: read only
CREATE POLICY "contact_group_members_staff_operator_read" ON contact_group_members
  FOR SELECT TO authenticated
  USING (
    get_user_role() IN ('staff', 'operator')
    AND is_active_user()
  );

-- ============================================================
-- TABLE: broadcast_jobs
-- Policy: Owner, Admin, and Staff have full CRUD.
-- Operator has no access.
-- ============================================================

ALTER TABLE broadcast_jobs ENABLE ROW LEVEL SECURITY;

-- Owner + Admin + Staff: full CRUD
CREATE POLICY "broadcast_jobs_owner_admin_staff_all" ON broadcast_jobs
  FOR ALL TO authenticated
  USING (get_user_role() IN ('owner', 'admin', 'staff') AND is_active_user())
  WITH CHECK (get_user_role() IN ('owner', 'admin', 'staff') AND is_active_user());

-- ============================================================
-- TABLE: broadcast_recipients
-- Policy: Owner, Admin, and Staff have full CRUD.
-- Operator has no access.
-- ============================================================

ALTER TABLE broadcast_recipients ENABLE ROW LEVEL SECURITY;

-- Owner + Admin + Staff: full CRUD
CREATE POLICY "broadcast_recipients_owner_admin_staff_all" ON broadcast_recipients
  FOR ALL TO authenticated
  USING (get_user_role() IN ('owner', 'admin', 'staff') AND is_active_user())
  WITH CHECK (get_user_role() IN ('owner', 'admin', 'staff') AND is_active_user());

-- ============================================================
-- TABLE: message_logs
-- Policy: Owner has full CRUD.
-- Admin and Staff can only SELECT.
-- Operator has no access.
-- ============================================================

ALTER TABLE message_logs ENABLE ROW LEVEL SECURITY;

-- Owner: full CRUD
CREATE POLICY "message_logs_owner_all" ON message_logs
  FOR ALL TO authenticated
  USING (get_user_role() = 'owner' AND is_active_user())
  WITH CHECK (get_user_role() = 'owner' AND is_active_user());

-- Admin + Staff: read only
CREATE POLICY "message_logs_admin_staff_read" ON message_logs
  FOR SELECT TO authenticated
  USING (
    get_user_role() IN ('admin', 'staff')
    AND is_active_user()
  );

-- ============================================================
-- TABLE: message_templates
-- Policy: Owner and Admin have full CRUD.
-- Staff can only SELECT.
-- Operator has no access.
-- ============================================================

ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;

-- Owner + Admin: full CRUD
CREATE POLICY "message_templates_owner_admin_all" ON message_templates
  FOR ALL TO authenticated
  USING (get_user_role() IN ('owner', 'admin') AND is_active_user())
  WITH CHECK (get_user_role() IN ('owner', 'admin') AND is_active_user());

-- Staff: read only
CREATE POLICY "message_templates_staff_read" ON message_templates
  FOR SELECT TO authenticated
  USING (
    get_user_role() = 'staff'
    AND is_active_user()
  );

-- ============================================================
-- TABLE: media_attachments
-- Policy: Owner and Admin have full CRUD.
-- Staff can only SELECT.
-- Operator has no access.
-- ============================================================

ALTER TABLE media_attachments ENABLE ROW LEVEL SECURITY;

-- Owner + Admin: full CRUD
CREATE POLICY "media_attachments_owner_admin_all" ON media_attachments
  FOR ALL TO authenticated
  USING (get_user_role() IN ('owner', 'admin') AND is_active_user())
  WITH CHECK (get_user_role() IN ('owner', 'admin') AND is_active_user());

-- Staff: read only
CREATE POLICY "media_attachments_staff_read" ON media_attachments
  FOR SELECT TO authenticated
  USING (
    get_user_role() = 'staff'
    AND is_active_user()
  );

-- ============================================================
-- TABLE: keyword_rules
-- Policy: Owner and Admin have full CRUD.
-- Staff can only SELECT.
-- Operator has no access.
-- ============================================================

ALTER TABLE keyword_rules ENABLE ROW LEVEL SECURITY;

-- Owner + Admin: full CRUD
CREATE POLICY "keyword_rules_owner_admin_all" ON keyword_rules
  FOR ALL TO authenticated
  USING (get_user_role() IN ('owner', 'admin') AND is_active_user())
  WITH CHECK (get_user_role() IN ('owner', 'admin') AND is_active_user());

-- Staff: read only
CREATE POLICY "keyword_rules_staff_read" ON keyword_rules
  FOR SELECT TO authenticated
  USING (
    get_user_role() = 'staff'
    AND is_active_user()
  );

-- ============================================================
-- TABLE: keyword_triggers
-- Policy: Owner and Admin have full CRUD.
-- Staff can only SELECT.
-- Operator has no access.
-- ============================================================

ALTER TABLE keyword_triggers ENABLE ROW LEVEL SECURITY;

-- Owner + Admin: full CRUD
CREATE POLICY "keyword_triggers_owner_admin_all" ON keyword_triggers
  FOR ALL TO authenticated
  USING (get_user_role() IN ('owner', 'admin') AND is_active_user())
  WITH CHECK (get_user_role() IN ('owner', 'admin') AND is_active_user());

-- Staff: read only
CREATE POLICY "keyword_triggers_staff_read" ON keyword_triggers
  FOR SELECT TO authenticated
  USING (
    get_user_role() = 'staff'
    AND is_active_user()
  );

-- ============================================================
-- TABLE: greeted_contacts
-- Policy: Owner and Admin have full CRUD.
-- Staff can only SELECT.
-- Operator has no access.
-- Note: Edge Functions using service_role key bypass RLS and
-- can INSERT/UPDATE freely for auto-reply tracking.
-- ============================================================

ALTER TABLE greeted_contacts ENABLE ROW LEVEL SECURITY;

-- Owner + Admin: full CRUD
CREATE POLICY "greeted_contacts_owner_admin_all" ON greeted_contacts
  FOR ALL TO authenticated
  USING (get_user_role() IN ('owner', 'admin') AND is_active_user())
  WITH CHECK (get_user_role() IN ('owner', 'admin') AND is_active_user());

-- Staff: read only
CREATE POLICY "greeted_contacts_staff_read" ON greeted_contacts
  FOR SELECT TO authenticated
  USING (
    get_user_role() = 'staff'
    AND is_active_user()
  );

-- ============================================================
-- TABLE: wa_sessions
-- Policy: Owner has full CRUD.
-- Admin and Staff can only SELECT.
-- Operator has no access.
-- ============================================================

ALTER TABLE wa_sessions ENABLE ROW LEVEL SECURITY;

-- Owner: full CRUD
CREATE POLICY "wa_sessions_owner_all" ON wa_sessions
  FOR ALL TO authenticated
  USING (get_user_role() = 'owner' AND is_active_user())
  WITH CHECK (get_user_role() = 'owner' AND is_active_user());

-- Admin + Staff: read only
CREATE POLICY "wa_sessions_admin_staff_read" ON wa_sessions
  FOR SELECT TO authenticated
  USING (
    get_user_role() IN ('admin', 'staff')
    AND is_active_user()
  );

-- ============================================================
-- TABLE: activity_logs
-- Policy: Owner and Admin can SELECT.
-- Staff and Operator have no direct access.
-- INSERT is performed exclusively by Edge Functions using the
-- service_role key (bypasses RLS) to ensure all actions are
-- logged regardless of the acting user's role.
-- ============================================================

ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

-- Owner + Admin: read only (no direct INSERT/UPDATE/DELETE for any user role)
CREATE POLICY "activity_logs_owner_admin_read" ON activity_logs
  FOR SELECT TO authenticated
  USING (
    get_user_role() IN ('owner', 'admin')
    AND is_active_user()
  );

-- ============================================================
-- TABLE: failed_login_attempts
-- Policy: Owner has full CRUD.
-- All other roles have no access.
-- Note: Edge Functions using service_role key bypass RLS for
-- recording and checking failed attempts during auth flow.
-- ============================================================

ALTER TABLE failed_login_attempts ENABLE ROW LEVEL SECURITY;

-- Owner: full CRUD
CREATE POLICY "failed_login_attempts_owner_all" ON failed_login_attempts
  FOR ALL TO authenticated
  USING (get_user_role() = 'owner' AND is_active_user())
  WITH CHECK (get_user_role() = 'owner' AND is_active_user());
