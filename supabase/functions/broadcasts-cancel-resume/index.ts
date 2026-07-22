/**
 * Edge Function: broadcasts-cancel-resume
 * PATCH /functions/v1/broadcasts-cancel-resume
 *
 * Body: { broadcast_id, action: 'cancel' | 'resume' }
 * Requirements: 6.8, 6.10
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  // Accept both PATCH and POST for compatibility
  if (req.method !== 'PATCH' && req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Unauthorized' }, 401)
  const { data: { user }, error: authError } = await supabase.auth.getUser(
    authHeader.replace('Bearer ', '')
  )
  if (authError || !user) return json({ error: 'Unauthorized' }, 401)

  const { broadcast_id, action } = await req.json() as { broadcast_id: string; action: 'cancel' | 'resume' }

  if (!broadcast_id || !['cancel', 'resume'].includes(action)) {
    return json({ error: 'broadcast_id and action (cancel|resume) required' }, 400)
  }

  const { data: job } = await supabase
    .from('broadcast_jobs')
    .select('id, status, wa_session_id, rate_limit_min_ms, rate_limit_max_ms')
    .eq('id', broadcast_id)
    .single()

  if (!job) return json({ error: 'Broadcast not found' }, 404)

  const gatewayUrl = Deno.env.get('GATEWAY_URL') ?? 'http://localhost:3001'
  const gatewayApiKey = Deno.env.get('GATEWAY_API_KEY') ?? ''

  if (action === 'cancel') {
    // Update DB status
    await supabase.from('broadcast_jobs')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', broadcast_id)

    // Cancel job in gateway queue
    try {
      await fetch(`${gatewayUrl}/jobs/${broadcast_id}/cancel`, {
        method: 'DELETE',
        headers: { 'x-api-key': gatewayApiKey },
      })
    } catch { /* fire and forget */ }

    return json({ broadcast_id, status: 'cancelled' })
  }

  if (action === 'resume') {
    if (!['paused', 'failed'].includes(job.status)) {
      return json({ error: `Cannot resume broadcast with status '${job.status}'` }, 400)
    }

    await supabase.from('broadcast_jobs')
      .update({ status: 'running', updated_at: new Date().toISOString() })
      .eq('id', broadcast_id)

    // Note: Gateway enqueue is handled by the client via Next.js proxy
    // because Supabase Edge Functions cannot reach localhost gateway.

    return json({ broadcast_id, status: 'running' })
  }

  return json({ error: 'Invalid action' }, 400)
})
