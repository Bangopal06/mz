/**
 * Edge Function: webhooks
 * Handles delivery callbacks and incoming messages from the gateway.
 *
 * PATCH /functions/v1/webhooks/delivery   — delivery status callback
 * POST  /functions/v1/webhooks/incoming   — incoming message (auto-reply)
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

async function verifyHmac(secret: string, body: string, signature: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
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

  // Verify HMAC for gateway callbacks
  if (hmacSecret && req.method === 'POST' || req.method === 'PATCH') {
    const sig = req.headers.get('x-gateway-signature') ?? ''
    if (sig && hmacSecret) {
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
  if (path.endsWith('/session-status')) {
    const { session_id, status, phone_number, display_name } = body as {
      session_id: string; status: string; phone_number?: string; display_name?: string
    }

    await supabase
      .from('wa_sessions')
      .update({ status, phone_number: phone_number ?? null, display_name: display_name ?? null, updated_at: new Date().toISOString() })
      .eq('id', session_id)

    return json({ ok: true })
  }

  // ── Delivery callback ──────────────────────────────────────────────────────
  if (path.endsWith('/delivery')) {
    const { broadcast_id, contact_id, status, error_code, error_message, sent_at } = body as {
      broadcast_id: string; contact_id: string; status: string
      error_code?: string; error_message?: string; sent_at?: string
    }

    // Update message_logs
    await supabase
      .from('message_logs')
      .update({ status, error_code: error_code ?? null, error_message: error_message ?? null, sent_at: sent_at ?? null })
      .eq('broadcast_id', broadcast_id)
      .eq('contact_id', contact_id)

    // Broadcast realtime channel for UI progress updates
    await supabase.channel(`broadcast:${broadcast_id}`).send({
      type: 'broadcast',
      event: 'delivery_update',
      payload: { broadcast_id, contact_id, status },
    })

    return json({ ok: true })
  }

  // ── Incoming message (auto-reply) ─────────────────────────────────────────
  if (path.endsWith('/incoming')) {
    const { session_id, from, message_text } = body as {
      session_id: string; from: string; message_text: string
    }

    if (!session_id || !from || !message_text) {
      return json({ error: 'session_id, from, message_text required' }, 400)
    }

    // Normalize phone number (strip @s.whatsapp.net)
    const waNumber = from.replace('@s.whatsapp.net', '')

    // Get active keyword rules with triggers
    const { data: rules } = await supabase
      .from('keyword_rules')
      .select('id, response_text, is_greeting, keyword_triggers(keyword)')
      .eq('is_active', true)

    if (!rules?.length) return json({ ok: true, matched: false })

    // Match keyword
    const normalizedMsg = message_text.toLowerCase()
    let matchedRule: { id: string; response_text: string; is_greeting: boolean } | null = null

    for (const rule of rules) {
      const triggers = (rule.keyword_triggers as { keyword: string }[]) ?? []
      const matched = triggers.some(t => normalizedMsg.includes(t.keyword.toLowerCase()))
      if (matched) {
        matchedRule = rule as { id: string; response_text: string; is_greeting: boolean }
        break
      }
    }

    if (!matchedRule) return json({ ok: true, matched: false })

    // Check greeting — only send once per contact per session
    if (matchedRule.is_greeting) {
      const { data: greeted } = await supabase
        .from('greeted_contacts')
        .select('id')
        .eq('wa_number', waNumber)
        .eq('session_id', session_id)
        .single()

      if (greeted) return json({ ok: true, matched: true, skipped: 'already_greeted' })

      // Mark as greeted
      await supabase.from('greeted_contacts').insert({ wa_number: waNumber, session_id })
    }

    // Send auto-reply via gateway
    const gatewayUrl = Deno.env.get('GATEWAY_URL') ?? 'http://localhost:3001'
    const gatewayApiKey = Deno.env.get('GATEWAY_API_KEY') ?? ''

    try {
      // Get session UUID from wa_sessions table
      const { data: sessionRow } = await supabase
        .from('wa_sessions')
        .select('id')
        .eq('id', session_id)
        .single()

      await fetch(`${gatewayUrl}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': gatewayApiKey },
        body: JSON.stringify({
          session_id: sessionRow?.id ?? session_id,
          to: waNumber,
          message: matchedRule.response_text,
        }),
      })

      // Log to activity_logs
      await supabase.from('activity_logs').insert({
        action: 'auto_reply.sent',
        entity_type: 'keyword_rule',
        entity_id: matchedRule.id,
        detail: { wa_number: waNumber, session_id, keyword_rule_id: matchedRule.id },
      })
    } catch (err) {
      console.error('[webhooks/incoming] Failed to send auto-reply:', err)
    }

    return json({ ok: true, matched: true, rule_id: matchedRule.id })
  }

  return json({ error: 'Not found' }, 404)
})
