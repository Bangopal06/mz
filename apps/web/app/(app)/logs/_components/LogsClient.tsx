'use client';

import { useState, useMemo } from 'react';
import type { ActivityLogWithUser } from '../page';

const ACTION_LABELS: Record<string, string> = {
  'login': 'Login',
  'login.failed': 'Login Gagal',
  'broadcast.create': 'Buat Broadcast',
  'broadcast.cancel': 'Cancel Broadcast',
  'broadcast.resume': 'Resume Broadcast',
  'contact.delete': 'Hapus Kontak',
  'user.role_change': 'Ubah Role User',
  'error.send': 'Error Kirim',
  'auto_reply.sent': 'Auto Reply',
  'session.expired': 'Sesi Expired',
};

const ACTION_COLORS: Record<string, string> = {
  'login': 'bg-green-50 text-green-700',
  'login.failed': 'bg-red-50 text-red-700',
  'broadcast.create': 'bg-blue-50 text-blue-700',
  'broadcast.cancel': 'bg-orange-50 text-orange-700',
  'contact.delete': 'bg-red-50 text-red-600',
  'user.role_change': 'bg-purple-50 text-purple-700',
  'error.send': 'bg-red-50 text-red-700',
  'auto_reply.sent': 'bg-teal-50 text-teal-700',
};

const PAGE_SIZE = 50;

export default function LogsClient({ initialLogs }: { initialLogs: ActivityLogWithUser[] }) {
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  const uniqueActions = useMemo(
    () => Array.from(new Set(initialLogs.map((l) => l.action))).sort(),
    [initialLogs]
  );

  const filtered = useMemo(() => {
    return initialLogs.filter((log) => {
      if (actionFilter && log.action !== actionFilter) return false;
      if (dateFrom && new Date(log.created_at) < new Date(dateFrom)) return false;
      if (dateTo) {
        const to = new Date(dateTo);
        to.setDate(to.getDate() + 1);
        if (new Date(log.created_at) >= to) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        const matchAction = log.action.toLowerCase().includes(q);
        const matchEntity = log.entity_type?.toLowerCase().includes(q) ?? false;
        const matchName = log.users?.full_name?.toLowerCase().includes(q) ?? false;
        const matchEmail = log.users?.email?.toLowerCase().includes(q) ?? false;
        if (!matchAction && !matchEntity && !matchName && !matchEmail) return false;
      }
      return true;
    });
  }, [initialLogs, search, actionFilter, dateFrom, dateTo]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function resetFilters() {
    setSearch('');
    setActionFilter('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  }

  const hasFilters = search || actionFilter || dateFrom || dateTo;

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Log Aktivitas</h1>
        <p className="text-sm text-gray-500 mt-0.5">Riwayat semua aktivitas sistem (retensi 90 hari)</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="text"
          placeholder="Cari user, aksi..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 w-52"
        />
        <select
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        >
          <option value="">Semua Aksi</option>
          {uniqueActions.map((a) => (
            <option key={a} value={a}>{ACTION_LABELS[a] ?? a}</option>
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
        {hasFilters && (
          <button
            onClick={resetFilters}
            className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            ✕ Reset
          </button>
        )}
      </div>

      <p className="text-xs text-gray-400">{filtered.length} entri ditemukan</p>

      {/* Table */}
      {paginated.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-sm">Belum ada log aktivitas yang sesuai filter.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Waktu</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Aksi</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">User</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Entitas</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paginated.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">
                    {new Date(log.created_at).toLocaleString('id-ID', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        ACTION_COLORS[log.action] ?? 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {ACTION_LABELS[log.action] ?? log.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                    <div className="text-sm">{log.users?.full_name ?? '—'}</div>
                    {log.users?.email && (
                      <div className="text-xs text-gray-400">{log.users.email}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                    {log.entity_type ? (
                      <span className="font-mono bg-gray-50 px-1.5 py-0.5 rounded">
                        {log.entity_type}
                        {log.entity_id ? `:${log.entity_id.slice(0, 8)}…` : ''}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 max-w-xs">
                    <span className="truncate block" title={JSON.stringify(log.detail)}>
                      {log.detail ? JSON.stringify(log.detail).slice(0, 80) : '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <p className="text-gray-500">
            Halaman {page} dari {totalPages} · {filtered.length} entri
          </p>
          <div className="flex gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 border rounded-lg hover:bg-gray-50 disabled:opacity-40"
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
                    pg === page ? 'bg-green-600 text-white border-green-600' : 'hover:bg-gray-50'
                  }`}
                >
                  {pg}
                </button>
              );
            })}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 border rounded-lg hover:bg-gray-50 disabled:opacity-40"
            >
              Berikutnya →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
