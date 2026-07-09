/**
 * Edge Function: session-expire-check
 *
 * Scheduled daily to mark WhatsApp sessions as 'expired' when the
 * current time has passed the session's expires_at timestamp.
 *
 * A session's expires_at is set to last_active_at + 30 days each time
 * a message is sent through that session (Requirement 8.5).
 *
 * This function should be invoked via a pg_cron job or Supabase
 * scheduled invocation once per day.
 *
 * Authorization: Bearer <SESSION_EXPIRE_SECRET> header required.
 *
 * Response:
 *   200 — { expired_count: number, session_ids: string[], timestamp: string }
 *   401 — Unauthorized
 *   500 — Internal server error
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  // Only allow POST or GET (invoked by scheduler)
  if (req.method !== 'POST' && req.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405)
  }

  // Verify internal authorization
  const authHeader = req.headers.get('Authorization')
  const expectedSecret = Deno.env.get('SESSION_EXPIRE_SECRET')
  if (expectedSecret && authHeader !== `Bearer ${expectedSecret}`) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const now = new Date().toISOString()

  // Find all sessions that are not already expired but whose expires_at has passed
  const { data: expiredSessions, error: selectError } = await supabase
    .from('wa_sessions')
    .select('id, session_key, expires_at, last_active_at')
    .neq('status', 'expired')
    .not('expires_at', 'is', null)
    .lt('expires_at', now)

  if (selectError) {
    console.error('[session-expire-check] Failed to query sessions:', selectError)
    return json({ error: selectError.message }, 500)
  }

  if (!expiredSessions || expiredSessions.length === 0) {
    return json({
      expired_count: 0,
      session_ids: [],
      timestamp: now,
    })
  }

  const sessionIds = expiredSessions.map((s: { id: string }) => s.id)

  // Mark all qualifying sessions as expired in one batch update
  const { error: updateError } = await supabase
    .from('wa_sessions')
    .update({
      status: 'expired',
      updated_at: now,
    })
    .in('id', sessionIds)

  if (updateError) {
    console.error('[session-expire-check] Failed to update sessions:', updateError)
    return json({ error: updateError.message }, 500)
  }

  // Log each expiration to activity_logs for audit trail (Requirement 10.1)
  const logEntries = expiredSessions.map((s: { id: string; session_key: string; expires_at: string }) => ({
    action: 'session.expired',
    entity_type: 'wa_session',
    entity_id: s.id,
    detail: {
      session_key: s.session_key,
      expires_at: s.expires_at,
      reason: 'inactivity_30_days',
    },
  }))

  const { error: logError } = await supabase
    .from('activity_logs')
    .insert(logEntries)

  if (logError) {
    // Non-fatal: log the error but don't fail the response
    console.warn('[session-expire-check] Failed to write activity_logs:', logError)
  }

  console.log(`[session-expire-check] Marked ${sessionIds.length} session(s) as expired:`, sessionIds)

  return json({
    expired_count: sessionIds.length,
    session_ids: sessionIds,
    timestamp: now,
  })
})
