'use client';

import { useState } from 'react';
import Link from 'next/link';

interface Broadcast {
  id: string;
  title: string;
  status: string;
  recipient_type: string;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  created_at: string;
  scheduled_at: string | null;
  completed_at: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  scheduled: 'bg-blue-100 text-blue-700',
  running: 'bg-yellow-100 text-yellow-700',
  paused: 'bg-orange-100 text-orange-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600',
  failed: 'bg-red-100 text-red-700',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', scheduled: 'Terjadwal', running: 'Berjalan', paused: 'Dijeda',
  completed: 'Selesai', cancelled: 'Dibatalkan', failed: 'Gagal',
};

function exportCSV(broadcasts: Broadcast[]) {
  const headers = ['Judul', 'Status', 'Total Penerima', 'Terkirim', 'Gagal', 'Tanggal'];
  const rows = broadcasts.map((b) => [b.title, b.status, b.total_recipients, b.sent_count, b.failed_count, new Date(b.created_at).toLocaleDateString('id-ID')]);
  const csv = [headers, ...rows].map((r) => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'broadcast-history.csv'; a.click();
  URL.revokeObjectURL(url);
}

export default function BroadcastsClient({ initialBroadcasts }: { initialBroadcasts: Broadcast[] }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const filtered = initialBroadcasts.filter((b) => {
    const matchSearch = !search || b.title.toLowerCase().includes(search.toLowerCase());
    const matchStatus = !statusFilter || b.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Riwayat Broadcast</h1>
        <div className="flex gap-2">
          <button onClick={() => exportCSV(filtered)} className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">📥 Ekspor CSV</button>
          <Link href="/broadcasts/new" className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 transition-colors">+ Broadcast Baru</Link>
        </div>
      </div>

      <div className="flex gap-3">
        <input
          type="text"
          placeholder="Cari judul..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 w-64"
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
          <option value="">Semua Status</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50">
            <tr>{['Judul', 'Status', 'Penerima', 'Terkirim', 'Gagal', 'Tanggal', ''].map((h) => <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">Tidak ada broadcast.</td></tr>
            ) : filtered.map((b) => {
              const pct = b.total_recipients > 0 ? Math.round((b.sent_count / b.total_recipients) * 100) : 0;
              return (
                <tr key={b.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{b.title}</td>
                  <td className="px-4 py-3"><span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[b.status] ?? 'bg-gray-100 text-gray-600'}`}>{STATUS_LABELS[b.status] ?? b.status}</span></td>
                  <td className="px-4 py-3 text-sm text-gray-600">{b.total_recipients.toLocaleString('id-ID')}</td>
                  <td className="px-4 py-3 text-sm text-green-700 font-medium">{b.sent_count.toLocaleString('id-ID')}</td>
                  <td className="px-4 py-3 text-sm text-red-600">{b.failed_count.toLocaleString('id-ID')}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{new Date(b.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                  <td className="px-4 py-3">
                    <Link href={`/broadcasts/${b.id}`} className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 transition-colors text-blue-600">Detail</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
