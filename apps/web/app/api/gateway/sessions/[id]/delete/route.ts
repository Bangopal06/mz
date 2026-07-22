import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/src/lib/supabase/server';

const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:3001';
const GATEWAY_API_KEY = process.env['GATEWAY_API_KEY'] ?? '';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  try {
    // Tell gateway to close socket and delete session files from disk
    // permanent=false so the session can be recreated on next connect
    await fetch(`${GATEWAY_URL}/sessions/${encodeURIComponent(id)}?permanent=false`, {
      method: 'DELETE',
      headers: { 'x-api-key': GATEWAY_API_KEY },
    });
    return NextResponse.json({ ok: true });
  } catch {
    // Non-fatal — DB delete will still proceed
    return NextResponse.json({ ok: true, warning: 'Gateway unreachable' });
  }
}
