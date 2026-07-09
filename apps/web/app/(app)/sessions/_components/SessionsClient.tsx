'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/src/lib/supabase/client';
import QRModal from './QRModal';

interface WASession {
  id: string;
  session_key: string;
  phone_number: string | null;
  display_name: string | null;
  status: 'connected' | 'disconnected' | 'expired' | 'pairing';
  last_active_at: string | null;
  expires_at: string | null;
  created_at: string;
}

type SessionStatus = WASession['status'];

interface StatusConfig {
  label: string;
  badgeClass: string;
  dotClass: string;
}

const STATUS_CONFIG: Record<SessionStatus, StatusConfig> = {
  connected: {
    label: 'Terhubung',
    badgeClass: 'bg-green-100 text-green-800',
    dotClass: 'bg-green-500',
  },
  disconnected: {
    label: 'Terputus',
    badgeClass: 'bg-red-100 text-red-700',
    dotClass: 'bg-red-400',
  },
  pairing: {
    label: 'Menunggu Scan',
    badgeClass: 'bg-blue-100 text-blue-700',
    dotClass: 'bg-blue-400 animate-pulse',
  },
  expired: {
    label: 'Kedaluwarsa',
    badgeClass: 'bg-yellow-100 text-yellow-700',
    dotClass: 'bg-yellow-400',
  },
};

interface QRTarget {
  sessionId: string;   // session_key for gateway
  sessionDbId: string; // UUID for DB operations
  label: string;
}

export default function SessionsClient({ initialSessions }: { initialSessions: WASession[] }) {
  const [sessions, setSessions] = useState<WASession[]>(initialSessions);
  const [showNewModal, setShowNewModal] = useState(false);
  const [qrTarget, setQrTarget] = useState<QRTarget | null>(null);
  const [newSessionKey, setNewSessionKey] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  // Supabase Realtime — subscribe to wa_sessions table changes
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('wa_sessions_live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'wa_sessions' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setSessions((prev) => [payload.new as WASession, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            setSessions((prev) =>
              prev.map((s) =>
                s.id === (payload.new as WASession).id ? (payload.new as WASession) : s
              )
            );
          } else if (payload.eventType === 'DELETE') {
            setSessions((prev) => prev.filter((s) => s.id !== (payload.old as WASession).id));
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  async function handleCreateSession() {
    const key = newSessionKey.trim();
    if (!key) return;
    setCreating(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('wa_sessions')
        .insert({ session_key: key, status: 'pairing' })
        .select()
        .single();
      if (error) { console.error('Failed to create session:', error.message); return; }
      if (data) {
        setSessions((prev) => [data as WASession, ...prev]);
        setQrTarget({ sessionId: key, sessionDbId: data.id, label: key });
        setShowNewModal(false);
        setNewSessionKey('');
      }
    } finally {
      setCreating(false);
    }
  }

  function handleShowQR(session: WASession) {
    const label = session.display_name ?? session.phone_number ?? session.session_key;
    setQrTarget({ sessionId: session.session_key, sessionDbId: session.id, label });
  }

  async function handleDisconnect(id: string) {
    setDisconnecting(id);
    try {
      await fetch(`/api/gateway/sessions/${encodeURIComponent(id)}/disconnect`, { method: 'POST' });
      const supabase = createClient();
      await supabase
        .from('wa_sessions')
        .update({ status: 'disconnected', updated_at: new Date().toISOString() })
        .eq('id', id);
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, status: 'disconnected' } : s)));
    } finally {
      setDisconnecting(null);
    }
  }

  async function handleDelete(id: string) {
    const supabase = createClient();
    await supabase.from('wa_sessions').delete().eq('id', id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
    setDeleteConfirm(null);
  }

  const connectedCount = sessions.filter((s) => s.status === 'connected').length;
  const expiredCount = sessions.filter((s) => s.status === 'expired').length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sesi WhatsApp</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Kelola koneksi nomor WhatsApp untuk broadcast
          </p>
        </div>
        <button
          onClick={() => setShowNewModal(true)}
          className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Tambah Sesi
        </button>
      </div>

      {sessions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
            Total: {sessions.length}
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            Terhubung: {connectedCount}
          </span>
          {expiredCount > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
              Kedaluwarsa: {expiredCount} &mdash; perlu scan ulang
            </span>
          )}
        </div>
      )}

      {sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-gray-400">
          <div className="w-16 h-16 mb-4 bg-gray-100 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          </div>
          <p className="text-sm font-medium">Belum ada sesi WhatsApp</p>
          <p className="text-xs mt-1">Tambah sesi baru untuk mulai mengirim broadcast</p>
          <button
            onClick={() => setShowNewModal(true)}
            className="mt-4 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"
          >
            Tambah Sesi Pertama
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              disconnecting={disconnecting === session.id}
              onShowQR={handleShowQR}
              onDisconnect={handleDisconnect}
              onDeleteRequest={setDeleteConfirm}
            />
          ))}
        </div>
      )}

      {/* New session modal */}
      {showNewModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-session-title"
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 id="new-session-title" className="text-base font-semibold text-gray-900">
              Tambah Sesi WhatsApp
            </h2>
            <div>
              <label htmlFor="session-key" className="block text-sm font-medium text-gray-700 mb-1">
                Nama / Identifikasi Sesi
              </label>
              <input
                id="session-key"
                value={newSessionKey}
                onChange={(e) => setNewSessionKey(e.target.value)}
                className="input"
                placeholder="sesi-utama, kantor, dll"
                onKeyDown={(e) => e.key === 'Enter' && handleCreateSession()}
                autoFocus
              />
              <p className="text-xs text-gray-400 mt-1">Digunakan sebagai pengenal unik untuk sesi ini</p>
            </div>
            <div className="bg-blue-50 rounded-xl p-4 text-sm text-blue-700">
              <p className="font-medium mb-1.5">Cara menghubungkan:</p>
              <ol className="list-decimal list-inside space-y-1 text-xs leading-relaxed">
                <li>Buat sesi &#8594; sistem generate ID sesi di gateway</li>
                <li>Klik &quot;Lihat QR Code&quot; setelah sesi dibuat</li>
                <li>Scan QR code dengan aplikasi WhatsApp di ponsel</li>
                <li>Status akan otomatis berubah menjadi Terhubung</li>
              </ol>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setShowNewModal(false); setNewSessionKey(''); }}
                className="px-4 py-2 text-sm border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50"
              >
                Batal
              </button>
              <button
                onClick={handleCreateSession}
                disabled={creating || !newSessionKey.trim()}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {creating ? 'Membuat...' : 'Buat Sesi'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QR Code Modal */}
      {qrTarget && (
        <QRModal
          sessionId={qrTarget.sessionId}
          sessionDbId={qrTarget.sessionDbId}
          sessionLabel={qrTarget.label}
          onClose={() => setQrTarget(null)}
          onConnected={() => {
            // Force update session status in local state immediately
            setSessions((prev) =>
              prev.map((s) =>
                s.id === qrTarget.sessionDbId ? { ...s, status: 'connected' } : s
              )
            );
          }}
        />
      )}

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <h3 className="font-semibold text-gray-900">Hapus Sesi?</h3>
            </div>
            <p className="text-sm text-gray-500">
              Sesi ini akan dihapus secara permanen. Broadcast yang menggunakan sesi ini tidak dapat dilanjutkan.
            </p>
            <div className="flex justify-end gap-3 pt-1">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-sm border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50"
              >
                Batal
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                Hapus
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Session Card component
interface SessionCardProps {
  session: WASession;
  disconnecting: boolean;
  onShowQR: (session: WASession) => void;
  onDisconnect: (id: string) => void;
  onDeleteRequest: (id: string) => void;
}

function SessionCard({ session, disconnecting, onShowQR, onDisconnect, onDeleteRequest }: SessionCardProps) {
  const cfg = STATUS_CONFIG[session.status] ?? STATUS_CONFIG['disconnected'];
  const label = session.display_name ?? session.phone_number ?? session.session_key;
  const showSubtitle = (session.display_name || session.phone_number) && session.session_key !== label;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={`flex-shrink-0 w-2.5 h-2.5 rounded-full ${cfg.dotClass}`} aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 truncate">{label}</p>
            {showSubtitle && (
              <p className="text-xs text-gray-400 font-mono truncate">
                {session.phone_number ?? session.session_key}
              </p>
            )}
          </div>
        </div>
        <span className={`flex-shrink-0 text-xs px-2 py-1 rounded-full font-medium ${cfg.badgeClass}`}>
          {cfg.label}
        </span>
      </div>

      <div className="space-y-0.5">
        {session.last_active_at && (
          <p className="text-xs text-gray-400">
            Terakhir aktif:{' '}
            {new Date(session.last_active_at).toLocaleString('id-ID', {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </p>
        )}
        {session.status === 'expired' && session.expires_at && (
          <p className="text-xs text-yellow-600 font-medium">
            Kedaluwarsa sejak:{' '}
            {new Date(session.expires_at).toLocaleString('id-ID', {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </p>
        )}
        <p className="text-xs text-gray-300 font-mono">ID: {session.id.slice(0, 8)}&hellip;</p>
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        {(session.status === 'pairing' || session.status === 'expired') && (
          <button
            onClick={() => onShowQR(session)}
            className="text-xs px-3 py-1.5 border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
          >
            {session.status === 'expired' ? 'Scan Ulang QR' : 'Lihat QR Code'}
          </button>
        )}
        {session.status === 'connected' && (
          <button
            onClick={() => onDisconnect(session.id)}
            disabled={disconnecting}
            className="text-xs px-3 py-1.5 border border-orange-200 text-orange-600 rounded-lg hover:bg-orange-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {disconnecting ? 'Memutus...' : 'Putuskan'}
          </button>
        )}
        {session.status === 'disconnected' && (
          <button
            onClick={() => onShowQR(session)}
            className="text-xs px-3 py-1.5 border border-green-200 text-green-600 rounded-lg hover:bg-green-50 transition-colors"
          >
            Hubungkan Ulang
          </button>
        )}
        <button
          onClick={() => onDeleteRequest(session.id)}
          className="text-xs px-3 py-1.5 border border-red-100 text-red-500 rounded-lg hover:bg-red-50 transition-colors ml-auto"
        >
          Hapus
        </button>
      </div>
    </div>
  );
}
