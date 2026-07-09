import { createClient } from 'jsr:@supabase/supabase-js@2'

Deno.serve(async (req) => {
  // Verify internal call (optional: check Authorization header)
  const authHeader = req.headers.get('Authorization')
  if (!authHeader || authHeader !== `Bearer ${Deno.env.get('CLEANUP_SECRET')}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - 90)

  const { count, error } = await supabase
    .from('activity_logs')
    .delete({ count: 'exact' })
    .lt('created_at', cutoffDate.toISOString())

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  return new Response(
    JSON.stringify({
      deleted: count,
      cutoff_date: cutoffDate.toISOString(),
      timestamp: new Date().toISOString()
    }),
    { headers: { 'Content-Type': 'application/json' } }
  )
})
