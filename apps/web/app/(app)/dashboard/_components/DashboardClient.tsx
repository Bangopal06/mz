'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/src/lib/supabase/client';

interface Session {
  id: string;
  session_key: string;
  phone_number: string | null;
  display_name: string | null;
  status: string;
}

interface TrendPoint {
  date: string;
  sent: number;
  failed: number;
}

interface Stats {
  totalContacts: number;
  sentToday: number;
  failedToday: number;
  activeBroadcasts: number;
  sessions: Session[];
  trend: TrendPoint[];
}

const STATUS_COLORS: Record<string, string> = {
  connected: 'bg-green-100 text-green-800',
  disconnected: 'bg-red-100 text-red-800',
  expired: 'bg-yellow-100 text-yellow-800',
  pairing: 'bg-blue-100 text-blue-800',
};

const STATUS_DOT: Record<string, string> = {
  connected: 'bg-green-500',
  disconnected: 'bg-red-400',
  expired: 'bg-yellow-400',
  pairing: 'bg-blue-400',
};

export default function DashboardClient({ stats: initialStats }: { stats: Stats }) {
  const [sessions, setSessions] = useState<Session[]>(initialStats.sessions);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('wa_sessions_status')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wa_sessions' }, (payload) => {
        if (payload.eventType === 'UPDATE') {
          setSessions((prev) =>
            prev.map((s) => (s.id === (payload.new as Session).id ? (payload.new as Session) : s))
          );
        } else if (payload.eventType === 'INSERT') {
          setSessions((prev) => [...prev, payload.new as Session]);
        } else if (payload.eventType === 'DELETE') {
          setSessions((prev) => prev.filter((s) => s.id !== (payload.old as Session).id));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const maxVal = Math.max(...initialStats.trend.map((t) => Math.max(t.sent, t.failed)), 1);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Kontak" value={initialStats.totalContacts.toLocaleString('id-ID')} color="blue" icon="👥" />
        <StatCard label="Terkirim Hari Ini" value={initialStats.sentToday.toLocaleString('id-ID')} color="green" icon="✅" />
        <StatCard label="Gagal Hari Ini" value={initialStats.failedToday.toLocaleString('id-ID')} color="red" icon="❌" />
        <StatCard label="Broadcast Aktif" value={initialStats.activeBroadcasts.toLocaleString('id-ID')} color="purple" icon="📢" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* WA Sessions */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Status Sesi WhatsApp</h2>
          {sessions.length === 0 ? (
            <p className="text-sm text-gray-400">Belum ada sesi terhubung.</p>
          ) : (
            <div className="space-y-3">
              {sessions.map((s) => (
                <div key={s.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`w-2 h-2 rounded-full ${STATUS_DOT[s.status] ?? 'bg-gray-400'}`} />
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {s.display_name ?? s.phone_number ?? s.session_key}
                      </p>
                      {s.phone_number && <p className="text-xs text-gray-500">{s.phone_number}</p>}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[s.status] ?? 'bg-gray-100 text-gray-700'}`}>
                    {s.status === 'connected' ? 'Online 🟢' : s.status === 'disconnected' ? 'Offline 🔴' : s.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Trend Chart (simple SVG bars) */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Tren 7 Hari Terakhir</h2>
          <div className="flex items-end gap-2 h-32">
            {initialStats.trend.map((point) => {
              const sentH = Math.round((point.sent / maxVal) * 100);
              const failH = Math.round((point.failed / maxVal) * 100);
              const label = new Date(point.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
              return (
                <div key={point.date} className="flex-1 flex flex-col items-center gap-1">
                  <div className="flex items-end gap-0.5 w-full h-24 justify-center">
                    <div
                      className="bg-green-400 rounded-t w-2"
                      style={{ height: `${sentH}%` }}
                      title={`Terkirim: ${point.sent}`}
                    />
                    <div
                      className="bg-red-300 rounded-t w-2"
                      style={{ height: `${failH}%` }}
                      title={`Gagal: ${point.failed}`}
                    />
                  </div>
                  <span className="text-xs text-gray-400 text-center leading-tight">{label}</span>
                </div>
              );
            })}
          </div>
          <div className="flex gap-4 mt-2">
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className="w-3 h-3 rounded bg-green-400" /> Terkirim
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className="w-3 h-3 rounded bg-red-300" /> Gagal
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color, icon }: { label: string; value: string; color: string; icon: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 border-blue-100',
    green: 'bg-green-50 border-green-100',
    red: 'bg-red-50 border-red-100',
    purple: 'bg-purple-50 border-purple-100',
  };
  const textColors: Record<string, string> = {
    blue: 'text-blue-700',
    green: 'text-green-700',
    red: 'text-red-700',
    purple: 'text-purple-700',
  };
  return (
    <div className={`rounded-2xl border p-4 ${colors[color] ?? 'bg-gray-50 border-gray-100'}`}>
      <div className="text-2xl mb-1">{icon}</div>
      <p className={`text-2xl font-bold ${textColors[color] ?? 'text-gray-900'}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  );
}
