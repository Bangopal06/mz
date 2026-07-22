'use client';

import { useEffect, useRef, useState } from 'react';
import QRCodeDisplay from './QRCodeDisplay';

type QRStatus = 'loading' | 'waiting' | 'connected' | 'error';

interface QRModalProps {
  sessionId: string;      // session_key for gateway
  sessionDbId: string;    // UUID for DB update
  sessionLabel: string;
  onClose: () => void;
  onConnected?: () => void;
}

export default function QRModal({ sessionId, sessionDbId, sessionLabel, onClose, onConnected }: QRModalProps) {
  const [qrString, setQrString] = useState<string | null>(null);
  const [qrStatus, setQrStatus] = useState<QRStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const closedRef = useRef(false);
  const connectedRef = useRef(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    closedRef.current = false;
    connectedRef.current = false;
    const controller = new AbortController();

    async function updateDbConnected() {
      try {
        const { createClient } = await import('@/src/lib/supabase/client');
        const supabase = createClient();
        await supabase
          .from('wa_sessions')
          .update({ status: 'connected', updated_at: new Date().toISOString() })
          .eq('id', sessionDbId);
      } catch { /* ignore */ }
    }

    async function handleConnectedEvent() {
      if (connectedRef.current) return;
      connectedRef.current = true;
      setQrStatus('connected');
      controller.abort();
      await updateDbConnected();
      onConnected?.();
      setTimeout(onClose, 2000);
    }

    // Poll gateway status every 2s as fallback
    const pollInterval = setInterval(async () => {
      if (connectedRef.current || closedRef.current) {
        clearInterval(pollInterval);
        return;
      }
      try {
        const res = await fetch(`/api/gateway/sessions/${encodeURIComponent(sessionId)}/status`);
        if (!res.ok) return;
        const data = await res.json() as { status: string };
        if (data.status === 'connected') {
          clearInterval(pollInterval);
          await handleConnectedEvent();
        }
      } catch { /* ignore */ }
    }, 2000);

    async function connectSSE() {
      try {
        const res = await fetch(
          `/api/gateway/sessions/${encodeURIComponent(sessionId)}/qr?dbId=${encodeURIComponent(sessionDbId)}`,
          { signal: controller.signal, headers: { Accept: 'text/event-stream' } }
        );

        if (!res.ok || !res.body) {
          if (!closedRef.current) { setQrStatus('error'); setErrorMessage('Gagal terhubung ke gateway.'); }
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!closedRef.current && !connectedRef.current) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';

          for (const chunk of parts) {
            let eventType = 'message';
            let data = '';
            for (const line of chunk.split('\n')) {
              if (line.startsWith('event:')) eventType = line.slice(6).trim();
              else if (line.startsWith('data:')) data = line.slice(5).trim();
            }
            if (!data) continue;
            try {
              const payload = JSON.parse(data) as Record<string, string>;
              if (eventType === 'qr' || payload['qr']) {
                setQrString(payload['qr'] ?? '');
                setQrStatus('waiting');
              } else if (payload['status'] === 'connected' || (eventType === 'done' && payload['status'] === 'connected')) {
                reader.releaseLock();
                clearInterval(pollInterval);
                await handleConnectedEvent();
                return;
              } else if (payload['error']) {
                const errCode = payload['error'] as string;
                let msg = `Error: ${errCode}`;
                if (errCode === 'GATEWAY_UNREACHABLE') {
                  msg = 'Tidak dapat terhubung ke WhatsApp Gateway. Pastikan gateway sedang berjalan.';
                } else if (errCode === 'GATEWAY_ERROR') {
                  const status = payload['status'];
                  const detail = payload['detail'];
                  if (status === 404) {
                    msg = `Sesi tidak ditemukan di gateway. Coba buat sesi baru.`;
                  } else {
                    msg = `Gateway error (${status ?? errCode})${detail ? ': ' + String(detail).slice(0, 100) : ''}.`;
                  }
                }
                setQrStatus('error');
                setErrorMessage(msg);
                reader.releaseLock();
                return;
              }
              // Ignore 'disconnected' during pairing — Baileys sometimes briefly disconnects before reconnecting
            } catch { /* ignore */ }
          }
        }
        try { reader.releaseLock(); } catch { /* ignore */ }
      } catch (err: unknown) {
        const isAbort = err instanceof Error && err.name === 'AbortError';
        if (!isAbort && !closedRef.current && !connectedRef.current) {
          setQrStatus('error');
          setErrorMessage('Koneksi ke gateway terputus.');
        }
      }
    }

    connectSSE();

    return () => {
      closedRef.current = true;
      clearInterval(pollInterval);
      controller.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, retryCount]);

  function handleClose() { closedRef.current = true; onClose(); }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" role="dialog" aria-modal="true" aria-labelledby="qr-modal-title">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 id="qr-modal-title" className="text-base font-semibold text-gray-900">Scan QR Code</h2>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600" aria-label="Tutup modal">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="text-sm text-gray-500">Sesi: <span className="font-medium text-gray-800">{sessionLabel}</span></p>

        <div className="flex items-center justify-center min-h-[272px]">
          {qrStatus === 'loading' && (
            <div className="flex flex-col items-center gap-3 text-gray-400">
              <div className="w-10 h-10 border-4 border-gray-200 border-t-green-500 rounded-full animate-spin" />
              <p className="text-sm">Memuat QR code...</p>
            </div>
          )}
          {qrStatus === 'waiting' && qrString && (
            <div className="flex flex-col items-center gap-2">
              <QRCodeDisplay qrString={qrString} size={256} />
              <p className="text-xs text-gray-400 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse inline-block" />
                Menunggu scan...
              </p>
            </div>
          )}
          {qrStatus === 'connected' && (
            <div className="flex flex-col items-center gap-3 text-green-600">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                <svg className="w-9 h-9" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm font-semibold">WhatsApp Terhubung!</p>
            </div>
          )}
          {qrStatus === 'error' && (
            <div className="flex flex-col items-center gap-3 text-red-500 text-center">
              <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center">
                <svg className="w-9 h-9" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              </div>
              <p className="text-sm font-medium">Terjadi Error</p>
              {errorMessage && <p className="text-xs text-gray-500">{errorMessage}</p>}
            </div>
          )}
        </div>

        {qrStatus === 'waiting' && (
          <div className="bg-green-50 rounded-xl p-3 space-y-1">
            <p className="text-xs font-medium text-green-800">Cara scan:</p>
            <ol className="list-decimal list-inside space-y-0.5 text-xs text-green-700">
              <li>Buka WhatsApp di ponsel</li>
              <li>Ketuk ikon titik tiga → Perangkat Tertaut</li>
              <li>Pilih &quot;Tautkan Perangkat&quot;</li>
              <li>Arahkan kamera ke QR di atas</li>
            </ol>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          {qrStatus === 'error' && (
            <button
              onClick={() => {
                closedRef.current = false;
                connectedRef.current = false;
                setQrString(null);
                setErrorMessage(null);
                setQrStatus('loading');
                setRetryCount((c) => c + 1);
              }}
              className="flex-1 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              Coba Lagi
            </button>
          )}
          <button onClick={handleClose} className="flex-1 px-4 py-2 text-sm border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50">
            {qrStatus === 'connected' ? 'Tutup' : 'Batal'}
          </button>
        </div>
      </div>
    </div>
  );
}
