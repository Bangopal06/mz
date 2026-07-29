'use client';

import { useEffect, useRef, useState } from 'react';
import QRCodeDisplay from './QRCodeDisplay';

type QRStatus = 'loading' | 'waiting' | 'connected' | 'error';

interface QRModalProps {
  sessionId: string;
  sessionDbId: string;
  sessionLabel: string;
  onClose: () => void;
  onConnected?: () => void;
}

export default function QRModal({ sessionId, sessionDbId, sessionLabel, onClose, onConnected }: QRModalProps) {
  const [qrString, setQrString] = useState<string | null>(null);
  const [qrStatus, setQrStatus] = useState<QRStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    async function updateDbConnected() {
      try {
        const { createClient } = await import('@/src/lib/supabase/client');
        const supabase = createClient();
        await supabase.from('wa_sessions')
          .update({ status: 'connected', updated_at: new Date().toISOString() })
          .eq('id', sessionDbId);
      } catch { /* ignore */ }
    }

    async function startQR() {
      try {
        const url = `/api/gateway/sessions/${encodeURIComponent(sessionId)}/qr?dbId=${encodeURIComponent(sessionDbId)}`;
        const res = await fetch(url, { headers: { Accept: 'text/event-stream' } });

        if (!mountedRef.current) return;

        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => '');
          setQrStatus('error');
          if (text.includes('Unauthorized') || res.status === 401) {
            setErrorMessage('Sesi login berakhir. Silakan logout dan login ulang.');
          } else {
            setErrorMessage(`Gagal terhubung ke gateway (HTTP ${res.status}).`);
          }
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (mountedRef.current) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';

          for (const chunk of parts) {
            if (!mountedRef.current) break;
            let eventType = 'message';
            let data = '';
            for (const line of chunk.split('\n')) {
              if (line.startsWith('event:')) eventType = line.slice(6).trim();
              else if (line.startsWith('data:')) data = line.slice(5).trim();
            }
            if (!data) continue;
            try {
              const payload = JSON.parse(data) as Record<string, string>;
              if (payload['qr'] || eventType === 'qr') {
                setQrString(payload['qr'] ?? '');
                setQrStatus('waiting');
              } else if (payload['status'] === 'connected' || (eventType === 'done' && payload['status'] === 'connected')) {
                reader.releaseLock();
                setQrStatus('connected');
                await updateDbConnected();
                onConnected?.();
                setTimeout(onClose, 2000);
                return;
              } else if (payload['error']) {
                let msg = `Error: ${payload['error']}`;
                if (payload['error'] === 'GATEWAY_UNREACHABLE') msg = 'Gateway tidak dapat dijangkau.';
                else if (payload['error'] === 'Unauthorized') msg = 'Sesi login berakhir. Logout dan login ulang.';
                setQrStatus('error');
                setErrorMessage(msg);
                reader.releaseLock();
                return;
              }
            } catch { /* ignore JSON parse errors */ }
          }
        }
        try { reader.releaseLock(); } catch { /* ignore */ }
      } catch (err) {
        if (!mountedRef.current) return;
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setQrStatus('error');
        setErrorMessage(`Koneksi gagal: ${msg}`);
      }
    }

    startQR();

    return () => { mountedRef.current = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, sessionDbId, retryCount]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Scan QR Code</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
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
              onClick={() => { setQrString(null); setErrorMessage(null); setQrStatus('loading'); setRetryCount(c => c + 1); }}
              className="flex-1 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              Coba Lagi
            </button>
          )}
          <button onClick={onClose} className="flex-1 px-4 py-2 text-sm border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50">
            {qrStatus === 'connected' ? 'Tutup' : 'Batal'}
          </button>
        </div>
      </div>
    </div>
  );
}
