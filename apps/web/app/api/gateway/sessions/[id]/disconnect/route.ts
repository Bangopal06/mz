import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/src/lib/supabase/server';

const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:3001';
const GATEWAY_API_KEY = process.env['GATEWAY_API_KEY'] ?? '';

/**
 * POST /api/gateway/sessions/[id]/disconnect
 *
 * Proxies a disconnect request to the WhatsApp Gateway.
 * The gateway API key is kept server-side.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Verify authentication
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const gatewayResponse = await fetch(
      `${GATEWAY_URL}/sessions/${encodeURIComponent(id)}/disconnect`,
      {
        method: 'POST',
        headers: {
          'x-api-key': GATEWAY_API_KEY,
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
        },
      }
    );

    if (!gatewayResponse.ok) {
      // Gateway returned an error — still return it so the UI can handle it
      return NextResponse.json(
        { error: 'GATEWAY_ERROR', status: gatewayResponse.status },
        { status: gatewayResponse.status }
      );
    }

    return NextResponse.json({ success: true });
  } catch {
    // Gateway unreachable
    return NextResponse.json({ error: 'GATEWAY_UNREACHABLE' }, { status: 503 });
  }
}
