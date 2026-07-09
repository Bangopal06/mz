'use client';

import { useState } from 'react';
import type { ActivityLogWithUser } from '../page';

const ACTION_LABELS: Record<string, string> = {
  'login': 'Login',
  'login.failed': 'Login Gagal',
  'broadcast.create': 'Buat Broadcast',
  'broadcast.cancel': 'Cancel Broadcast',
  'contact.delete': 'Hapus Kontak',
  'user.role_change': 'Ubah Role User',
  'error.send': 'Error Kirim',
  'auto_reply.sent': 'Auto Reply',
  'session.expired': 'Sesi Expired',
};

export default function LogsClient({ initialLogs }: { initialLogs: ActivityLogWithUser[] }) {
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');

  const uniqueActions = Array.from(new Set(initialLogs.map((l) => l.action)));

  const filtered = initialLogs.filter((log) => {
    const matchAction = actionFilter ? log.action === actionFilter : true;
    const matchSearch = search
      ? log.action.includes(search) ||
        log.entity_type?.includes(search) ||
        log.users?.full_name?.toLowerCase().includes(search.toLowerCase()) ||
        log.users?.email?.toLowerCase().includes(search.toLowerCase())
      : true;
    return matchAction && matchSearch;
  });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Log Aktivitas</h1>
        <p className="text-sm text-gray-500 mt-0.5">Riwayat semua aktivitas sistem</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Cari..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input w-64"
        />
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="input w-48"
        >
          <option value="">Semua Aksi</option>
          {uniqueActions.map((a) => (
            <option key={a} value={a}>{ACTION_LABELS[a] ?? a}</option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-sm">Belum ada log aktivitas</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Waktu</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Aksi</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">User</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {new Date(log.created_at).toLocaleString('id-ID', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                      {ACTION_LABELS[log.action] ?? log.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {log.users?.full_name ?? log.users?.email ?? '-'}
                  </td>
                  <td className="px-4 py-3 text-gray-500 max-w-xs truncate">
                    {log.entity_type && (
                      <span className="text-xs text-gray-400">{log.entity_type}: </span>
                    )}
                    {log.detail ? JSON.stringify(log.detail).slice(0, 80) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
