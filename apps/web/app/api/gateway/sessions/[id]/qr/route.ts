import { type NextRequest } from 'next/server';
import { createClient } from '@/src/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:3001';
const GATEWAY_API_KEY = process.env['GATEWAY_API_KEY'] ?? '';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return new Response('data: {"error":"Unauthorized"}\n\n', {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  const { id } = await params;
  // Forward dbId query param to gateway so it can link contacts to this session
  const dbId = request.nextUrl.searchParams.get('dbId');
  const gatewayQrUrl = dbId
    ? `${GATEWAY_URL}/sessions/${encodeURIComponent(id)}/qr?dbId=${encodeURIComponent(dbId)}`
    : `${GATEWAY_URL}/sessions/${encodeURIComponent(id)}/qr`;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let gatewayRes: Response;

      try {
        gatewayRes = await fetch(
          gatewayQrUrl,
          {
            headers: {
              'x-api-key': GATEWAY_API_KEY,
              'Accept': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'ngrok-skip-browser-warning': 'true',
            },
            signal: request.signal,
          }
        );
      } catch {
        controller.enqueue(encoder.encode('data: {"error":"GATEWAY_UNREACHABLE"}\n\n'));
        controller.close();
        return;
      }

      if (!gatewayRes.ok || !gatewayRes.body) {
        // Try to read gateway error body for better diagnostics
        let detail = '';
        try {
          detail = await gatewayRes.text();
        } catch { /* ignore */ }
        console.error(`[QR Route] Gateway error ${gatewayRes.status} for session "${id}": ${detail}`);
        controller.enqueue(
          encoder.encode(
            `data: {"error":"GATEWAY_ERROR","status":${gatewayRes.status},"detail":${JSON.stringify(detail.slice(0, 200))}}\n\n`
          )
        );
        controller.close();
        return;
      }

      const reader = gatewayRes.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
      } catch {
        // client disconnected
      } finally {
        reader.releaseLock();
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Transfer-Encoding': 'chunked',
    },
  });
}
