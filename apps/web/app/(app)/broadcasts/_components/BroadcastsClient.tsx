'use client';

import { useState, useMemo } from 'react';
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
  draft: 'Draft',
  scheduled: 'Terjadwal',
  running: 'Berjalan',
  paused: 'Dijeda',
  completed: 'Selesai',
  cancelled: 'Dibatalkan',
  failed: 'Gagal',
};

const PAGE_SIZE = 50;

function exportCSV(broadcasts: Broadcast[]) {
  const headers = ['Judul', 'Status', 'Total Penerima', 'Terkirim', 'Gagal', 'Tanggal Dibuat'];
  const rows = broadcasts.map((b) => [
    `"${b.title.replace(/"/g, '""')}"`,
    b.status,
    b.total_recipients,
    b.sent_count,
    b.failed_count,
    new Date(b.created_at).toLocaleDateString('id-ID'),
  ]);
  const csv = [headers, ...rows].map((r) => r.join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'broadcast-history.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export default function BroadcastsClient({ initialBroadcasts }: { initialBroadcasts: Broadcast[] }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    return initialBroadcasts.filter((b) => {
      if (search && !b.title.toLowerCase().includes(search.toLowerCase())) return false;
      if (statusFilter && b.status !== statusFilter) return false;
      if (dateFrom && new Date(b.created_at) < new Date(dateFrom)) return false;
      if (dateTo) {
        const to = new Date(dateTo);
        to.setDate(to.getDate() + 1); // inclusive
        if (new Date(b.created_at) >= to) return false;
      }
      return true;
    });
  }, [initialBroadcasts, search, statusFilter, dateFrom, dateTo]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function resetFilters() {
    setSearch('');
    setStatusFilter('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  }

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Riwayat Broadcast</h1>
        <div className="flex gap-2">
          <button
            onClick={() => exportCSV(filtered)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            📥 Ekspor CSV
          </button>
          <Link
            href="/broadcasts/new"
            className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 transition-colors"
          >
            + Broadcast Baru
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Cari judul..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 w-52"
        />
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        >
          <option value="">Semua Status</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <div className="flex items-center gap-1.5 text-sm text-gray-500">
          <span>Dari</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <span>s/d</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>
        {(search || statusFilter || dateFrom || dateTo) && (
          <button
            onClick={resetFilters}
            className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            ✕ Reset
          </button>
        )}
      </div>

      <p className="text-xs text-gray-400">
        {filtered.length} broadcast ditemukan
      </p>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50">
            <tr>
              {['Judul', 'Status', 'Penerima', 'Terkirim', 'Gagal', 'Tanggal Dibuat', ''].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {paginated.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">
                  Tidak ada broadcast yang sesuai filter.
                </td>
              </tr>
            ) : (
              paginated.map((b) => {
                const pct =
                  b.total_recipients > 0
                    ? Math.round((b.sent_count / b.total_recipients) * 100)
                    : 0;
                return (
                  <tr key={b.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      <div>{b.title}</div>
                      {b.status === 'running' && (
                        <div className="mt-1 w-32">
                          <div className="w-full bg-gray-100 rounded-full h-1.5">
                            <div
                              className="bg-green-500 h-1.5 rounded-full transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <p className="text-xs text-gray-400 mt-0.5">{pct}%</p>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs px-2 py-1 rounded-full font-medium ${
                          STATUS_COLORS[b.status] ?? 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {STATUS_LABELS[b.status] ?? b.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {b.total_recipients.toLocaleString('id-ID')}
                    </td>
                    <td className="px-4 py-3 text-sm text-green-700 font-medium">
                      {b.sent_count.toLocaleString('id-ID')}
                    </td>
                    <td className="px-4 py-3 text-sm text-red-600">
                      {b.failed_count.toLocaleString('id-ID')}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {new Date(b.created_at).toLocaleDateString('id-ID', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/broadcasts/${b.id}`}
                        className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 transition-colors text-blue-600"
                      >
                        Detail
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <p className="text-gray-500">
            Halaman {page} dari {totalPages}
          </p>
          <div className="flex gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50 disabled:opacity-40"
            >
              ← Sebelumnya
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const pg = Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
              return (
                <button
                  key={pg}
                  onClick={() => setPage(pg)}
                  className={`px-3 py-1.5 border rounded-lg text-sm ${
                    pg === page
                      ? 'bg-green-600 text-white border-green-600'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  {pg}
                </button>
              );
            })}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50 disabled:opacity-40"
            >
              Berikutnya →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
