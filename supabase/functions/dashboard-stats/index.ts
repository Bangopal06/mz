/**
 * Edge Function: dashboard-stats
 * Returns aggregated statistics for the dashboard in a single request.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.5, 1.8
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

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayIso = todayStart.toISOString()

  // Run all queries in parallel
  const [
    contactsRes,
    sentTodayRes,
    failedTodayRes,
    activeBroadcastsRes,
    sessionsRes,
    trendRes,
  ] = await Promise.all([
    supabase.from('contacts').select('id', { count: 'exact', head: true }),
    supabase.from('message_logs').select('id', { count: 'exact', head: true })
      .eq('status', 'sent').gte('created_at', todayIso),
    supabase.from('message_logs').select('id', { count: 'exact', head: true })
      .eq('status', 'failed').gte('created_at', todayIso),
    supabase.from('broadcast_jobs').select('id', { count: 'exact', head: true })
      .in('status', ['running', 'pending', 'scheduled']),
    supabase.from('wa_sessions').select('id, session_key, status, phone_number, display_name, last_active_at'),
    // 7-day trend: get message logs for last 7 days
    supabase.from('message_logs')
      .select('status, created_at')
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
  ])

  // Build 7-day trend
  const trendMap: Record<string, { sent: number; failed: number }> = {}
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    trendMap[key] = { sent: 0, failed: 0 }
  }

  for (const row of (trendRes.data ?? [])) {
    const key = (row.created_at as string).slice(0, 10)
    if (trendMap[key]) {
      if (row.status === 'sent') trendMap[key]!.sent++
      else if (row.status === 'failed') trendMap[key]!.failed++
    }
  }

  const trend = Object.entries(trendMap).map(([date, counts]) => ({ date, ...counts }))

  return json({
    total_contacts: contactsRes.count ?? 0,
    sent_today: sentTodayRes.count ?? 0,
    failed_today: failedTodayRes.count ?? 0,
    active_broadcasts: activeBroadcastsRes.count ?? 0,
    sessions: sessionsRes.data ?? [],
    trend_7days: trend,
  })
})
