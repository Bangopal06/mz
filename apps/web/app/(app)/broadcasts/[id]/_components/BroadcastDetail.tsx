'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/src/lib/supabase/client';
import { showToast } from '@/src/components/Toast';

interface Log { id: string; wa_number: string; status: string; error_message: string | null; sent_at: string | null; }
interface Broadcast { id: string; title: string; status: string; total_recipients: number; sent_count: number; failed_count: number; message_body: string; created_at: string; scheduled_at: string | null; wa_session_id: string; }

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600', sent: 'bg-green-100 text-green-700',
  delivered: 'bg-blue-100 text-blue-700', read: 'bg-purple-100 text-purple-700', failed: 'bg-red-100 text-red-600',
};

function exportLogsCSV(logs: Log[], title: string) {
  const csv = ['Nomor WA,Status,Waktu Kirim,Error', ...logs.map((l) => `${l.wa_number},${l.status},${l.sent_at ?? ''},${l.error_message ?? ''}`)].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `${title}-detail.csv`; a.click();
  URL.revokeObjectURL(url);
}

export default function BroadcastDetail({ broadcast: initial, initialLogs }: { broadcast: Broadcast; initialLogs: Log[] }) {
  const [broadcast, setBroadcast] = useState(initial);
  const [logs, setLogs] = useState(initialLogs);
  const [actionLoading, setActionLoading] = useState(false);

  async function handleAction(action: 'cancel' | 'resume') {
    setActionLoading(true);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/broadcasts-cancel-resume`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token ?? ''}`,
            apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
          },
          body: JSON.stringify({ broadcast_id: broadcast.id, action }),
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Gagal melakukan aksi');
      }

      const { status: newStatus } = await res.json();
      setBroadcast((prev) => ({ ...prev, status: newStatus }));

      // If resuming, enqueue to gateway via Next.js proxy
      if (action === 'resume') {
        await fetch('/api/gateway/broadcast/enqueue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            broadcast_id: broadcast.id,
            session_id: broadcast.wa_session_id,
          }),
        }).catch(() => console.warn('Gateway enqueue failed'));
      }

      showToast(action === 'cancel' ? 'Broadcast dibatalkan' : 'Broadcast dilanjutkan', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal melakukan aksi', 'error');
    } finally {
      setActionLoading(false);
    }
  }

  useEffect(() => {
    const supabase = createClient();

    // Subscribe to postgres_changes for DB-level updates
    const dbChannel = supabase
      .channel(`broadcast_db_${broadcast.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'broadcast_jobs', filter: `id=eq.${broadcast.id}` },
        (p) => setBroadcast((prev) => ({ ...prev, ...(p.new as Broadcast) }))
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'message_logs', filter: `broadcast_id=eq.${broadcast.id}` },
        (p) => setLogs((prev) => [...prev, p.new as Log])
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'message_logs', filter: `broadcast_id=eq.${broadcast.id}` },
        (p) => setLogs((prev) => prev.map((l) => l.id === (p.new as Log).id ? (p.new as Log) : l))
      )
      .subscribe();

    // Also subscribe to the broadcast Realtime channel pushed by the webhook Edge Function.
    // This gives faster progress updates than waiting for postgres_changes propagation.
    const rtChannel = supabase
      .channel(`broadcast:${broadcast.id}`)
      .on('broadcast', { event: 'delivery_update' }, ({ payload }) => {
        const { contact_id, status } = payload as { contact_id: string; status: string };
        setLogs((prev) =>
          prev.map((l) =>
            l.id === contact_id ? { ...l, status } : l
          )
        );
        // Refresh aggregate counters by re-fetching the job row
        supabase
          .from('broadcast_jobs')
          .select('sent_count, failed_count, total_recipients, status, last_sent_index')
          .eq('id', broadcast.id)
          .single()
          .then(({ data }) => {
            if (data) setBroadcast((prev) => ({ ...prev, ...data }));
          });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(dbChannel);
      supabase.removeChannel(rtChannel);
    };
  }, [broadcast.id]);

  const pending = broadcast.total_recipients - broadcast.sent_count - broadcast.failed_count;
  const pct = broadcast.total_recipients > 0 ? Math.round(((broadcast.sent_count) / broadcast.total_recipients) * 100) : 0;

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Link href="/broadcasts" className="text-sm text-gray-500 hover:text-gray-700">← Kembali</Link>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
        <div className="flex items-start justify-between">
          <h1 className="text-xl font-bold text-gray-900">{broadcast.title}</h1>
          <div className="flex gap-2">
            <button onClick={() => window.location.reload()} className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50">🔄 Refresh</button>
            <button onClick={() => exportLogsCSV(logs, broadcast.title)} className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50">📥 CSV</button>
            {broadcast.status === 'running' && (
              <button onClick={() => handleAction('cancel')} disabled={actionLoading}
                className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-60">
                {actionLoading ? '...' : '⏹ Batalkan'}
              </button>
            )}
            {(broadcast.status === 'paused' || broadcast.status === 'failed') && (
              <button onClick={() => handleAction('resume')} disabled={actionLoading}
                className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-60">
                {actionLoading ? '...' : '▶ Lanjutkan'}
              </button>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatBox label="Total Penerima" value={broadcast.total_recipients} color="gray" />
          <StatBox label="Terkirim" value={broadcast.sent_count} color="green" />
          <StatBox label="Gagal" value={broadcast.failed_count} color="red" />
          <StatBox label="Pending" value={Math.max(0, pending)} color="yellow" />
        </div>

        {/* Progress bar */}
        {broadcast.status === 'running' && (
          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Progress</span><span>{pct}%</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-2">
              <div className="bg-green-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* Logs table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50">
            <tr>{['Nomor WA', 'Status', 'Waktu Kirim', 'Error'].map((h) => <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {logs.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-gray-400">Belum ada log.</td></tr>
            ) : logs.map((l) => (
              <tr key={l.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm font-mono text-gray-700">{l.wa_number}</td>
                <td className="px-4 py-3"><span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[l.status] ?? ''}`}>{l.status}</span></td>
                <td className="px-4 py-3 text-sm text-gray-500">{l.sent_at ? new Date(l.sent_at).toLocaleString('id-ID') : '—'}</td>
                <td className="px-4 py-3 text-xs text-red-500">{l.error_message ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: number; color: string }) {
  const c: Record<string, string> = { gray: 'bg-gray-50', green: 'bg-green-50', red: 'bg-red-50', yellow: 'bg-yellow-50' };
  const tc: Record<string, string> = { gray: 'text-gray-700', green: 'text-green-700', red: 'text-red-700', yellow: 'text-yellow-700' };
  return (
    <div className={`rounded-xl p-3 ${c[color]}`}>
      <p className={`text-xl font-bold ${tc[color]}`}>{value.toLocaleString('id-ID')}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}
