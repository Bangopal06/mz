import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/src/lib/supabase/server';

const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:3001';
const GATEWAY_API_KEY = process.env['GATEWAY_API_KEY'] ?? '';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json() as { broadcast_id: string; session_id: string };

  try {
    await fetch(`${GATEWAY_URL}/jobs/enqueue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': GATEWAY_API_KEY, 'ngrok-skip-browser-warning': 'true' },
      body: JSON.stringify({
        broadcast_id: body.broadcast_id,
        session_id: body.session_id,
        rate_limit_min_ms: 3000,
        rate_limit_max_ms: 10000,
      }),
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Gateway unreachable' }, { status: 503 });
  }
}
