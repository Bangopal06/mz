/**
 * Edge Function: broadcasts
 * POST /functions/v1/broadcasts — Buat broadcast baru
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4
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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Auth check
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Unauthorized' }, 401)
  const { data: { user }, error: authError } = await supabase.auth.getUser(
    authHeader.replace('Bearer ', '')
  )
  if (authError || !user) return json({ error: 'Unauthorized' }, 401)

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: {
    title: string
    message_body?: string
    template_id?: string
    recipient_type: 'all' | 'group' | 'manual'
    group_ids?: string[]
    contact_ids?: string[]
    wa_session_id: string
    scheduled_at?: string
    attachment_id?: string
  }

  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const { title, message_body, template_id, recipient_type, group_ids, contact_ids, wa_session_id, scheduled_at, attachment_id } = body

  if (!title || !wa_session_id || !recipient_type) {
    return json({ error: 'title, wa_session_id, and recipient_type are required' }, 400)
  }
  if (!message_body && !template_id) {
    return json({ error: 'Either message_body or template_id is required' }, 400)
  }

  // Resolve message body from template if needed
  let resolvedMessage = message_body ?? ''
  if (template_id) {
    const { data: tpl } = await supabase
      .from('message_templates')
      .select('body')
      .eq('id', template_id)
      .single()
    if (tpl) resolvedMessage = tpl.body
  }

  // Resolve recipients
  let contactIds: string[] = []

  if (recipient_type === 'all') {
    const { data: contacts } = await supabase
      .from('contacts')
      .select('id')
      .eq('status', 'active')
    contactIds = (contacts ?? []).map((c: { id: string }) => c.id)
  } else if (recipient_type === 'group' && group_ids?.length) {
    const { data: members } = await supabase
      .from('contact_group_members')
      .select('contact_id')
      .in('group_id', group_ids)
    // Deduplicate
    const ids = new Set((members ?? []).map((m: { contact_id: string }) => m.contact_id))
    contactIds = Array.from(ids)
  } else if (recipient_type === 'manual' && contact_ids?.length) {
    contactIds = contact_ids
  }

  if (contactIds.length === 0) {
    return json({ error: 'No recipients found' }, 400)
  }

  // Create broadcast_jobs row
  const { data: job, error: jobError } = await supabase
    .from('broadcast_jobs')
    .insert({
      title,
      message_body: resolvedMessage,
      template_id: template_id ?? null,
      attachment_id: attachment_id ?? null,
      recipient_type,
      wa_session_id,
      scheduled_at: scheduled_at ?? null,
      status: scheduled_at ? 'scheduled' : 'pending',
      total_recipients: contactIds.length,
      sent_count: 0,
      failed_count: 0,
      last_sent_index: 0,
      rate_limit_min_ms: 3000,
      rate_limit_max_ms: 10000,
      created_by: user.id,
    })
    .select()
    .single()

  if (jobError || !job) {
    return json({ error: jobError?.message ?? 'Failed to create broadcast' }, 500)
  }

  // Insert recipients with send_order
  const recipientRows = contactIds.map((cid: string, idx: number) => ({
    broadcast_id: job.id,
    contact_id: cid,
    send_order: idx + 1,
    status: 'pending',
  }))

  const { error: recipError } = await supabase
    .from('broadcast_recipients')
    .insert(recipientRows)

  if (recipError) {
    return json({ error: recipError.message }, 500)
  }

  // If immediate (no schedule), enqueue to gateway
  if (!scheduled_at) {
    const gatewayUrl = Deno.env.get('GATEWAY_URL') ?? 'http://localhost:3001'
    const gatewayApiKey = Deno.env.get('GATEWAY_API_KEY') ?? ''

    try {
      await fetch(`${gatewayUrl}/jobs/enqueue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': gatewayApiKey },
        body: JSON.stringify({
          broadcast_id: job.id,
          session_id: wa_session_id,
          rate_limit_min_ms: 3000,
          rate_limit_max_ms: 10000,
        }),
      })

      await supabase
        .from('broadcast_jobs')
        .update({ status: 'running' })
        .eq('id', job.id)
    } catch (err) {
      console.error('[broadcasts] Failed to enqueue job:', err)
      // Don't fail the request — broadcast is created, can be retried
    }
  }

  return json({ broadcast_id: job.id, status: job.status, total_recipients: contactIds.length }, 201)
})
