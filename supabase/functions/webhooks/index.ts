/**
 * Edge Function: webhooks
 * Handles delivery callbacks and incoming messages from the gateway.
 *
 * PATCH /functions/v1/webhooks/delivery       — delivery status callback from gateway
 * POST  /functions/v1/webhooks/incoming       — incoming message (auto-reply)
 * POST  /functions/v1/webhooks/session-status — session status update
 *
 * Requirements: 6.6, 6.9, 12.2, 12.4, 12.7, 12.8
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-gateway-signature',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

/** Verify HMAC-SHA256 signature from gateway */
async function verifyHmac(secret: string, body: string, signature: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
  const hex = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  return signature === `sha256=${hex}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  const url = new URL(req.url)
  const path = url.pathname

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const hmacSecret = Deno.env.get('WEBHOOK_HMAC_SECRET') ?? ''
  const rawBody = await req.text()

  // Verify HMAC signature for gateway callbacks (delivery, session-status)
  if (hmacSecret && (req.method === 'POST' || req.method === 'PATCH')) {
    const sig = req.headers.get('x-gateway-signature') ?? ''
    if (sig) {
      const valid = await verifyHmac(hmacSecret, rawBody, sig)
      if (!valid) return json({ error: 'Invalid signature' }, 401)
    }
  }

  let body: Record<string, unknown>
  try {
    body = rawBody ? JSON.parse(rawBody) : {}
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  // ── Session status update ──────────────────────────────────────────────────
  // POST /webhooks/session-status
  // Gateway calls this when connection state changes (connected/disconnected/etc.)
  if (path.endsWith('/session-status')) {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

    const { session_id, status, phone_number, display_name } = body as {
      session_id: string
      status: string
      phone_number?: string
      display_name?: string
    }

    if (!session_id || !status) {
      return json({ error: 'session_id and status required' }, 400)
    }

    // session_id from gateway is the session_key (string), not the DB UUID.
    // Update wa_sessions WHERE session_key = session_id.
    const { error: updateErr } = await supabase
      .from('wa_sessions')
      .update({
        status,
        phone_number: phone_number ?? null,
        display_name: display_name ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('session_key', session_id)

    if (updateErr) {
      console.error('[webhooks/session-status] DB error:', updateErr.message)
      return json({ error: updateErr.message }, 500)
    }

    // Broadcast realtime so UI badge updates without reload
    await supabase.channel('wa_sessions').send({
      type: 'broadcast',
      event: 'session_status_changed',
      payload: { session_id, status },
    })

    return json({ ok: true })
  }

  // ── Delivery callback ──────────────────────────────────────────────────────
  // PATCH /webhooks/delivery
  // Gateway calls this after each message send attempt (success or failure).
  // Requirements: 6.6, 6.9
  if (path.endsWith('/delivery')) {
    if (req.method !== 'PATCH') return json({ error: 'Method not allowed' }, 405)

    const {
      broadcast_id,
      contact_id,
      wa_number,
      status,
      error_code,
      error_message,
      sent_at,
    } = body as {
      broadcast_id: string
      contact_id: string
      wa_number: string
      status: string   // 'sent' | 'delivered' | 'read' | 'failed'
      error_code?: string
      error_message?: string
      sent_at?: string
    }

    if (!broadcast_id || !contact_id || !status) {
      return json({ error: 'broadcast_id, contact_id, and status are required' }, 400)
    }

    // Upsert message_logs — gateway may send status updates for same message multiple times
    const { error: logErr } = await supabase
      .from('message_logs')
      .upsert(
        {
          broadcast_id,
          contact_id,
          wa_number: wa_number ?? '',
          status,
          error_code: error_code ?? null,
          error_message: error_message ?? null,
          sent_at: sent_at ?? null,
        },
        { onConflict: 'broadcast_id,contact_id' }
      )

    if (logErr) {
      console.error('[webhooks/delivery] message_logs upsert error:', logErr.message)
      return json({ error: logErr.message }, 500)
    }

    // Update aggregate counters on broadcast_jobs
    // Increment sent_count or failed_count and advance last_sent_index
    if (status === 'sent' || status === 'delivered' || status === 'read') {
      await supabase.rpc('increment_broadcast_sent', { p_broadcast_id: broadcast_id })
    } else if (status === 'failed') {
      await supabase.rpc('increment_broadcast_failed', { p_broadcast_id: broadcast_id })
    }

    // Broadcast realtime event for UI progress bar
    // Clients subscribed to channel `broadcast:{id}` will receive this
    await supabase.channel(`broadcast:${broadcast_id}`).send({
      type: 'broadcast',
      event: 'delivery_update',
      payload: { broadcast_id, contact_id, status },
    })

    return json({ ok: true })
  }

  // ── Incoming message (auto-reply) ─────────────────────────────────────────
  // POST /webhooks/incoming
  // Gateway calls this for every inbound WhatsApp message received.
  // Requirements: 12.2, 12.4, 12.7, 12.8
  if (path.endsWith('/incoming')) {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

    const { session_id, from, message_text } = body as {
      session_id: string
      from: string
      message_text: string
    }

    if (!session_id || !from || !message_text) {
      return json({ error: 'session_id, from, message_text required' }, 400)
    }

    // Normalize: strip WhatsApp JID suffix if present
    const waNumber = from.replace('@s.whatsapp.net', '')

    // Fetch all active keyword rules with their triggers
    const { data: rules, error: rulesErr } = await supabase
      .from('keyword_rules')
      .select('id, response_text, is_greeting, keyword_triggers(keyword)')
      .eq('is_active', true)

    if (rulesErr) {
      console.error('[webhooks/incoming] Failed to fetch rules:', rulesErr.message)
      return json({ error: rulesErr.message }, 500)
    }

    if (!rules?.length) return json({ ok: true, matched: false })

    // Find first matching rule (case-insensitive substring match)
    const normalizedMsg = message_text.toLowerCase()
    let matchedRule: { id: string; response_text: string; is_greeting: boolean } | null = null

    for (const rule of rules) {
      const triggers = (rule.keyword_triggers as { keyword: string }[]) ?? []
      const hit = triggers.some(t => normalizedMsg.includes(t.keyword.toLowerCase()))
      if (hit) {
        matchedRule = rule as { id: string; response_text: string; is_greeting: boolean }
        break
      }
    }

    if (!matchedRule) return json({ ok: true, matched: false })

    // Greeting guard: only send once per contact per session (Req 12.8)
    if (matchedRule.is_greeting) {
      const { data: greeted } = await supabase
        .from('greeted_contacts')
        .select('contact_wa_number')
        .eq('contact_wa_number', waNumber)
        .eq('session_id', session_id)
        .maybeSingle()

      if (greeted) return json({ ok: true, matched: true, skipped: 'already_greeted' })

      // Record greeting to prevent future duplicates
      await supabase.from('greeted_contacts').insert({
        contact_wa_number: waNumber,
        session_id,
      })
    }

    // Send auto-reply via gateway
    const gatewayUrl = Deno.env.get('GATEWAY_URL') ?? 'http://localhost:3001'
    const gatewayApiKey = Deno.env.get('GATEWAY_API_KEY') ?? ''

    try {
      await fetch(`${gatewayUrl}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': gatewayApiKey,
        },
        body: JSON.stringify({
          session_id,
          to: waNumber,
          message: matchedRule.response_text,
        }),
      })
    } catch (err) {
      console.error('[webhooks/incoming] Failed to send auto-reply:', err)
      // Don't return error — log and continue so webhook ACKs gateway
    }

    // Audit log
    await supabase.from('activity_logs').insert({
      action: 'auto_reply.sent',
      entity_type: 'keyword_rule',
      entity_id: matchedRule.id,
      detail: {
        wa_number: waNumber,
        session_id,
        keyword_rule_id: matchedRule.id,
      },
    })

    return json({ ok: true, matched: true, rule_id: matchedRule.id })
  }

  return json({ error: 'Not found' }, 404)
})
