/**
 * POST /api/chat/send
 * Sends a message (text or image) through the WhatsApp Gateway.
 * Requirements: 6.2, 6.3, 6.4, 6.5, 7.5, 7.6, 7.7, 10.3, 10.4
 */

import { createClient } from '@/src/lib/supabase/server';
import { createServiceClient } from '@/src/lib/supabase/service';
import { NextRequest, NextResponse } from 'next/server';

const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:3001';
const GATEWAY_API_KEY = process.env['GATEWAY_API_KEY'] ?? '';

export async function POST(req: NextRequest) {
  // Validate Supabase Auth session
  const supabase = await createClient();
  const { data: { session }, error: authError } = await supabase.auth.getSession();

  if (authError || !session) {
    return NextResponse.json(
      { error: 'Unauthorized', error_code: 'UNAUTHENTICATED' },
      { status: 401 }
    );
  }

  // Parse request body
  let body: {
    session_id?: string;
    to?: string;
    message?: string;
    image_url?: string;
    caption?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { session_id, to, message, image_url, caption } = body;

  if (!session_id) return NextResponse.json({ error: 'session_id is required' }, { status: 400 });
  if (!to) return NextResponse.json({ error: 'to is required' }, { status: 400 });
  if (!message && !image_url) return NextResponse.json({ error: 'message or image_url required' }, { status: 400 });

  // Use service client to bypass RLS for both wa_sessions lookup and chat_messages insert
  const serviceClient = createServiceClient();

  // Lookup session_key from UUID — gateway uses session_key, not UUID
  const { data: waSession, error: sessionError } = await serviceClient
    .from('wa_sessions')
    .select('session_key')
    .eq('id', session_id)
    .single();

  if (sessionError || !waSession?.session_key) {
    console.error('[API/chat/send] Session not found:', session_id, sessionError?.message);
    return NextResponse.json({ error: 'Session not found', error_code: 'SESSION_NOT_FOUND' }, { status: 404 });
  }

  const sessionKey = waSession.session_key;

  // Build gateway payload
  const gatewayPayload: Record<string, unknown> = { session_id: sessionKey, to };
  if (image_url) {
    gatewayPayload['media'] = {
      url: image_url,
      mime_type: image_url.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg',
      caption: caption ?? undefined,
    };
  } else {
    gatewayPayload['message'] = message;
  }

  // Call gateway
  let gatewayResponse: Response;
  try {
    gatewayResponse = await fetch(`${GATEWAY_URL}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': GATEWAY_API_KEY },
      body: JSON.stringify(gatewayPayload),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    console.error('[API/chat/send] Gateway unreachable:', err);
    await insertChatMessage(serviceClient, { wa_session_id: session_id, to, message: message ?? null, image_url: image_url ?? null, caption: caption ?? null, status: 'failed', wa_message_id: null });
    return NextResponse.json({ error: 'Gateway unreachable', error_code: 'GATEWAY_TIMEOUT' }, { status: 502 });
  }

  if (!gatewayResponse.ok) {
    let errorText = '';
    try { const e = await gatewayResponse.json(); errorText = e.error ?? e.message ?? ''; } catch { errorText = await gatewayResponse.text().catch(() => ''); }
    console.error('[API/chat/send] Gateway error:', gatewayResponse.status, errorText);
    await insertChatMessage(serviceClient, { wa_session_id: session_id, to, message: message ?? null, image_url: image_url ?? null, caption: caption ?? null, status: 'failed', wa_message_id: null });
    return NextResponse.json({ error: errorText || 'Gateway error', error_code: 'GATEWAY_ERROR' }, { status: 502 });
  }

  let gatewayData: { message_id?: string } = {};
  try { gatewayData = await gatewayResponse.json(); } catch { /* ignore */ }

  const waMessageId = gatewayData.message_id ?? null;

  const chatMessageId = await insertChatMessage(serviceClient, {
    wa_session_id: session_id,
    to,
    message: message ?? null,
    image_url: image_url ?? null,
    caption: caption ?? null,
    status: 'sent',
    wa_message_id: waMessageId,
  });

  return NextResponse.json({ message_id: waMessageId ?? '', status: 'sent', chat_message_id: chatMessageId ?? '' });
}

async function insertChatMessage(
  serviceClient: ReturnType<typeof createServiceClient>,
  params: {
    wa_session_id: string;
    to: string;
    message: string | null;
    image_url: string | null;
    caption: string | null;
    status: 'sent' | 'failed';
    wa_message_id: string | null;
  }
): Promise<string | null> {
  try {
    const { data, error } = await serviceClient
      .from('chat_messages')
      .insert({
        wa_session_id: params.wa_session_id,
        contact_wa_number: params.to,
        direction: 'outbound',
        message_type: params.image_url ? 'image' : 'text',
        body: params.image_url ? (params.caption ?? null) : params.message,
        media_url: params.image_url ?? null,
        wa_message_id: params.wa_message_id,
        status: params.status,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[API/chat/send] DB insert failed:', error.message, error.details);
      return null;
    }
    return data?.id ?? null;
  } catch (err) {
    console.error('[API/chat/send] DB insert exception:', err);
    return null;
  }
}
