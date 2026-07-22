import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/src/lib/supabase/server';

const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:3001';
const GATEWAY_API_KEY = process.env['GATEWAY_API_KEY'] ?? '';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  try {
    const res = await fetch(`${GATEWAY_URL}/sessions`, {
      headers: { 'x-api-key': GATEWAY_API_KEY, 'ngrok-skip-browser-warning': 'true' },
    });
    if (!res.ok) return NextResponse.json({ status: 'unknown' });
    const data = await res.json() as { sessions: { id: string; status: string; phone_number?: string; display_name?: string }[] };
    const found = data.sessions.find((s) => s.id === id);
    return NextResponse.json({ status: found?.status ?? 'unknown', phone_number: found?.phone_number, display_name: found?.display_name });
  } catch {
    return NextResponse.json({ status: 'unknown' });
  }
}
