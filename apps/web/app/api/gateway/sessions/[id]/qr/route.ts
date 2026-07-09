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

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let gatewayRes: Response;

      try {
        gatewayRes = await fetch(
          `${GATEWAY_URL}/sessions/${encodeURIComponent(id)}/qr`,
          {
            headers: {
              'x-api-key': GATEWAY_API_KEY,
              'Accept': 'text/event-stream',
              'Cache-Control': 'no-cache',
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
        controller.enqueue(encoder.encode(`data: {"error":"GATEWAY_ERROR","status":${gatewayRes.status}}\n\n`));
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
