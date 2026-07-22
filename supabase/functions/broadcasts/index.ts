/**
 * Edge Function: broadcasts
 * POST /functions/v1/broadcasts — Buat broadcast job baru
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4
 *
 * Request body:
 *   title          string   — required
 *   message_body   string   — required if no template_id
 *   template_id    string   — required if no message_body (UUID of message_templates)
 *   recipient_type string   — 'all' | 'group' | 'manual'
 *   group_ids      string[] — required when recipient_type = 'group'
 *   contact_ids    string[] — required when recipient_type = 'manual'
 *   wa_session_id  string   — required (UUID of wa_sessions)
 *   scheduled_at   string   — optional ISO timestamp; null/omit = send immediately
 *   attachment_id  string   — optional (UUID of media_attachments)
 *
 * Responses:
 *   201 — Broadcast created, returns { broadcast_id, status, total_recipients }
 *   400 — Validation error
 *   401 — Unauthorized
 *   405 — Method not allowed
 *   500 — Server error
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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  // Only accept POST
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // Create Supabase service-role client (bypasses RLS for admin operations)
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // ── Authentication ─────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Unauthorized' }, 401)

  const { data: { user }, error: authError } = await supabase.auth.getUser(
    authHeader.replace('Bearer ', '')
  )
  if (authError || !user) return json({ error: 'Unauthorized' }, 401)

  // Lookup public.users.id from auth_user_id (FK for created_by columns)
  const { data: userProfile } = await supabase
    .from('users')
    .select('id')
    .eq('auth_user_id', user.id)
    .single()
  const publicUserId = userProfile?.id ?? null

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: {
    title?: unknown
    message_body?: unknown
    template_id?: unknown
    recipient_type?: unknown
    group_ids?: unknown
    contact_ids?: unknown
    wa_session_id?: unknown
    scheduled_at?: unknown
    attachment_id?: unknown
  }

  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const {
    title,
    message_body,
    template_id,
    recipient_type,
    group_ids,
    contact_ids,
    wa_session_id,
    scheduled_at,
    attachment_id,
  } = body

  // ── Input validation ────────────────────────────────────────────────────────
  if (!title || typeof title !== 'string' || title.trim() === '') {
    return json({ error: 'title is required and must be a non-empty string' }, 400)
  }

  if (!wa_session_id || typeof wa_session_id !== 'string') {
    return json({ error: 'wa_session_id is required' }, 400)
  }

  if (!recipient_type || !['all', 'group', 'manual'].includes(recipient_type as string)) {
    return json({ error: "recipient_type must be 'all', 'group', or 'manual'" }, 400)
  }

  if (!message_body && !template_id) {
    return json({ error: 'Either message_body or template_id is required' }, 400)
  }

  // Validate recipient-type-specific fields
  if (recipient_type === 'group' && (!Array.isArray(group_ids) || (group_ids as unknown[]).length === 0)) {
    return json({ error: 'group_ids array is required when recipient_type is group' }, 400)
  }

  if (recipient_type === 'manual' && (!Array.isArray(contact_ids) || (contact_ids as unknown[]).length === 0)) {
    return json({ error: 'contact_ids array is required when recipient_type is manual' }, 400)
  }

  // Validate scheduled_at format if provided
  if (scheduled_at !== undefined && scheduled_at !== null) {
    if (typeof scheduled_at !== 'string' || isNaN(Date.parse(scheduled_at as string))) {
      return json({ error: 'scheduled_at must be a valid ISO 8601 timestamp' }, 400)
    }
  }

  // ── Resolve message body from template if needed ────────────────────────────
  let resolvedMessage = typeof message_body === 'string' ? message_body.trim() : ''

  if (template_id && typeof template_id === 'string') {
    const { data: tpl, error: tplError } = await supabase
      .from('message_templates')
      .select('body')
      .eq('id', template_id)
      .single()

    if (tplError || !tpl) {
      return json({ error: `Template not found: ${template_id}` }, 400)
    }

    resolvedMessage = tpl.body
  }

  if (!resolvedMessage) {
    return json({ error: 'Message body cannot be empty' }, 400)
  }

  // ── Resolve recipients ──────────────────────────────────────────────────────
  let contactIds: string[] = []

  if (recipient_type === 'all') {
    // Req 6.1: all active contacts
    const { data: contacts, error: contactsError } = await supabase
      .from('contacts')
      .select('id')
      .eq('status', 'active')

    if (contactsError) {
      return json({ error: 'Failed to fetch contacts: ' + contactsError.message }, 500)
    }

    contactIds = (contacts ?? []).map((c: { id: string }) => c.id)

  } else if (recipient_type === 'group') {
    // Req 6.2: members of selected contact groups (only active contacts)
    // First get all member contact IDs from the selected groups
    const { data: members, error: membersError } = await supabase
      .from('contact_group_members')
      .select('contact_id')
      .in('group_id', group_ids as string[])

    if (membersError) {
      return json({ error: 'Failed to fetch group members: ' + membersError.message }, 500)
    }

    if (!members || members.length === 0) {
      return json({ error: 'No recipients found in the selected groups' }, 400)
    }

    // Deduplicate — a contact may appear in multiple selected groups
    const rawIds = Array.from(new Set(members.map((m: { contact_id: string }) => m.contact_id)))

    // Filter to only active contacts
    const { data: activeContacts, error: activeError } = await supabase
      .from('contacts')
      .select('id')
      .in('id', rawIds)
      .eq('status', 'active')

    if (activeError) {
      return json({ error: 'Failed to filter active contacts: ' + activeError.message }, 500)
    }

    contactIds = (activeContacts ?? []).map((c: { id: string }) => c.id)

  } else if (recipient_type === 'manual') {
    // Req 6.3: explicitly selected contacts
    // Validate that the provided contact IDs exist and are active
    const { data: validContacts, error: validError } = await supabase
      .from('contacts')
      .select('id')
      .in('id', contact_ids as string[])
      .eq('status', 'active')

    if (validError) {
      return json({ error: 'Failed to validate contacts: ' + validError.message }, 500)
    }

    contactIds = (validContacts ?? []).map((c: { id: string }) => c.id)
  }

  if (contactIds.length === 0) {
    return json({ error: 'No active recipients found for this broadcast' }, 400)
  }

  // ── Determine initial status ────────────────────────────────────────────────
  // Req 6.4: immediate = 'running', scheduled = 'scheduled'
  const isScheduled = scheduled_at !== undefined && scheduled_at !== null
  const initialStatus = isScheduled ? 'scheduled' : 'running'

  // ── Insert broadcast_jobs ───────────────────────────────────────────────────
  const { data: job, error: jobError } = await supabase
    .from('broadcast_jobs')
    .insert({
      title: (title as string).trim(),
      message_body: resolvedMessage,
      template_id: (typeof template_id === 'string' && template_id) ? template_id : null,
      attachment_id: (typeof attachment_id === 'string' && attachment_id) ? attachment_id : null,
      recipient_type,
      wa_session_id,
      scheduled_at: isScheduled ? scheduled_at : null,
      status: initialStatus,
      started_at: isScheduled ? null : new Date().toISOString(),
      total_recipients: contactIds.length,
      sent_count: 0,
      failed_count: 0,
      last_sent_index: 0,
      rate_limit_min_ms: 3000,
      rate_limit_max_ms: 10000,
      created_by: publicUserId,
    })
    .select()
    .single()

  if (jobError || !job) {
    return json({ error: jobError?.message ?? 'Failed to create broadcast job' }, 500)
  }

  // ── Insert broadcast_recipients with send_order ─────────────────────────────
  const recipientRows = contactIds.map((cid: string, idx: number) => ({
    broadcast_id: job.id,
    contact_id: cid,
    send_order: idx + 1,
  }))

  const { error: recipError } = await supabase
    .from('broadcast_recipients')
    .insert(recipientRows)

  if (recipError) {
    // Rollback: remove the job we just created to keep DB consistent
    await supabase.from('broadcast_jobs').delete().eq('id', job.id)
    return json({ error: 'Failed to insert recipients: ' + recipError.message }, 500)
  }

  // ── Log activity ────────────────────────────────────────────────────────────
  await supabase.from('activity_logs').insert({
    user_id: publicUserId,
    action: 'broadcast.create',
    entity_type: 'broadcast',
    entity_id: job.id,
    detail: {
      title: job.title,
      recipient_type,
      total_recipients: contactIds.length,
      scheduled_at: isScheduled ? scheduled_at : null,
    },
  })

  // ── Enqueue to gateway if immediate ────────────────────────────────────────
  // Note: Gateway enqueue is handled by the Next.js API route (/api/gateway/broadcast/enqueue)
  // because Supabase Edge Functions cannot reach localhost gateway.
  // The client calls that route after receiving broadcast_id from this function.
  // If broadcast was immediate, mark as 'paused' initially — client will enqueue via Next.js proxy.
  if (!isScheduled) {
    // Mark as paused until client enqueues via Next.js proxy to gateway
    await supabase
      .from('broadcast_jobs')
      .update({ status: 'paused' })
      .eq('id', job.id)
  }

  // Re-fetch job to return accurate status (may have been updated to paused above)
  const { data: finalJob } = await supabase
    .from('broadcast_jobs')
    .select('id, status, total_recipients')
    .eq('id', job.id)
    .single()

  return json(
    {
      broadcast_id: finalJob?.id ?? job.id,
      status: finalJob?.status ?? job.status,
      total_recipients: contactIds.length,
    },
    201
  )
})
