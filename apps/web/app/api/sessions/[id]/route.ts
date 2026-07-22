import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:3001';
const GATEWAY_API_KEY = process.env['GATEWAY_API_KEY'] ?? '';

// Use service role key to bypass RLS for delete operations
function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? '';
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '';
  if (!url || !key) {
    throw new Error(`Missing Supabase config: url=${!!url} key=${!!key}`);
  }
  return createClient(url, key);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params; // this is the DB UUID (wa_sessions.id)

  try {
    const supabase = getServiceClient();

    // 1. Get session_key so we can tell gateway to delete disk files
    const { data: session } = await supabase
      .from('wa_sessions')
      .select('session_key')
      .eq('id', id)
      .single();

    // 2. Tell gateway to close socket + delete session files from disk
    if (session?.session_key) {
      await fetch(
        `${GATEWAY_URL}/sessions/${encodeURIComponent(session.session_key)}`,
        { method: 'DELETE', headers: { 'x-api-key': GATEWAY_API_KEY } }
      ).catch(() => {});
    }

    // 3. Delete wa_sync contacts from this session (if migration 007 applied)
    try {
      await supabase
        .from('contacts')
        .delete()
        .eq('source_session_id', id);
    } catch {
      // safe — fails gracefully if column doesn't exist yet
    }

    // 4. Delete the session from DB
    const { error } = await supabase
      .from('wa_sessions')
      .delete()
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
