'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/src/lib/supabase/client';

interface Group { id: string; name: string; }
interface Template { id: string; title: string; body: string; }
interface Session { id: string; session_key: string; phone_number: string | null; display_name: string | null; status: string; }

const SAMPLE = { nama: 'Ahmad', nomor: '6281234567890' };
function preview(body: string) {
  return body.replace(/\{\{nama\}\}/g, SAMPLE.nama).replace(/\{\{nomor\}\}/g, SAMPLE.nomor);
}

export default function BroadcastWizard({ groups, templates, sessions }: { groups: Group[]; templates: Template[]; sessions: Session[] }) {
  const router = useRouter();
  const [step, setStep] = useState(1);

  // Step 1: recipients
  const [recipientType, setRecipientType] = useState<'all' | 'group' | 'manual'>('all');
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);

  // Step 2: message
  const [templateId, setTemplateId] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [title, setTitle] = useState('');

  // Step 3: schedule
  const [sessionId, setSessionId] = useState(sessions[0]?.id ?? '');
  const [scheduledAt, setScheduledAt] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function handleTemplateSelect(id: string) {
    setTemplateId(id);
    const t = templates.find((t) => t.id === id);
    if (t) setMessageBody(t.body);
  }

  function toggleGroup(id: string) {
    setSelectedGroups((prev) => prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]);
  }

  async function handleSubmit() {
    if (!title.trim()) { setError('Judul broadcast wajib diisi.'); return; }
    if (!messageBody.trim()) { setError('Isi pesan wajib diisi.'); return; }
    if (!sessionId) { setError('Pilih sesi WhatsApp.'); return; }
    if (recipientType === 'group' && selectedGroups.length === 0) { setError('Pilih minimal satu grup.'); return; }

    setLoading(true);
    setError('');

    try {
      const supabase = createClient();

      // Resolve recipients
      let contactIds: string[] = [];
      if (recipientType === 'all') {
        console.log('[Broadcast] Fetching all contacts...');
        const { data, error } = await supabase.from('contacts').select('id').eq('status', 'active');
        console.log('[Broadcast] contacts result:', data?.length, error?.message);
        contactIds = (data ?? []).map((c: { id: string }) => c.id);
      } else if (recipientType === 'group' && selectedGroups.length > 0) {
        console.log('[Broadcast] Fetching group members for groups:', selectedGroups);
        const { data, error } = await supabase
          .from('contact_group_members')
          .select('contact_id')
          .in('group_id', selectedGroups);
        console.log('[Broadcast] group members result:', data?.length, error?.message);
        const ids = new Set((data ?? []).map((m: { contact_id: string }) => m.contact_id));
        contactIds = Array.from(ids);
      }

      console.log('[Broadcast] contactIds:', contactIds.length);
      if (contactIds.length === 0) {
        setError('Tidak ada penerima ditemukan. Pastikan grup memiliki anggota.');
        setLoading(false);
        return;
      }

      // Get current user profile id (public.users.id, not auth.uid)
      const { data: { user: authUser } } = await supabase.auth.getUser();
      const { data: userProfile } = await supabase
        .from('users')
        .select('id')
        .eq('auth_user_id', authUser?.id ?? '')
        .single();

      // Insert broadcast job
      const { data: job, error: jobErr } = await supabase
        .from('broadcast_jobs')
        .insert({
          title,
          message_body: messageBody,
          template_id: templateId || null,
          wa_session_id: sessionId,
          recipient_type: recipientType,
          scheduled_at: scheduledAt || null,
          status: scheduledAt ? 'scheduled' : 'draft',
          total_recipients: contactIds.length,
          sent_count: 0,
          failed_count: 0,
          last_sent_index: 0,
          rate_limit_min_ms: 3000,
          rate_limit_max_ms: 10000,
          created_by: userProfile?.id ?? null,
        })
        .select()
        .single();

      if (jobErr || !job) throw new Error(jobErr?.message ?? 'Gagal membuat broadcast.');

      // Insert recipients
      const recipients = contactIds.map((cid: string, idx: number) => ({
        broadcast_id: (job as { id: string }).id,
        contact_id: cid,
        send_order: idx + 1,
      }));
      await supabase.from('broadcast_recipients').insert(recipients);

      // Enqueue to gateway if immediate (fire and forget)
      if (!scheduledAt) {
        fetch('/api/gateway/broadcast/enqueue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            broadcast_id: (job as { id: string }).id,
            session_id: sessionId,
          }),
        }).catch(() => {});
      }

      // Log activity
      supabase.from('activity_logs').insert({
        user_id: userProfile?.id ?? null,
        action: 'broadcast.create',
        entity_type: 'broadcast_job',
        entity_id: (job as { id: string }).id,
        detail: { title, total_recipients: contactIds.length, recipient_type: recipientType },
      }).then(() => {});

      router.push(`/broadcasts/${(job as { id: string }).id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan.');
      setLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Broadcast Baru</h1>
        <div className="flex gap-1">
          {[1, 2, 3].map((s) => (
            <div key={s} className={`w-8 h-2 rounded-full ${s <= step ? 'bg-green-500' : 'bg-gray-200'}`} />
          ))}
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded-lg">{error}</div>}

      {/* Step 1: Penerima */}
      {step === 1 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
          <h2 className="font-semibold text-gray-900">Langkah 1: Pilih Penerima</h2>
          <div className="space-y-2">
            {(['all', 'group'] as const).map((type) => (
              <label key={type} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${recipientType === type ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                <input type="radio" value={type} checked={recipientType === type} onChange={() => setRecipientType(type)} className="text-green-600" />
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {type === 'all' ? 'Semua Kontak Aktif' : 'Grup Tertentu'}
                  </p>
                  <p className="text-xs text-gray-500">
                    {type === 'all' ? 'Kirim ke semua kontak dengan status aktif' : 'Pilih satu atau lebih grup kontak'}
                  </p>
                </div>
              </label>
            ))}
          </div>

          {recipientType === 'group' && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-700">Pilih Grup:</p>
              {groups.map((g) => (
                <label key={g.id} className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${selectedGroups.includes(g.id) ? 'border-green-400 bg-green-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                  <input type="checkbox" checked={selectedGroups.includes(g.id)} onChange={() => toggleGroup(g.id)} className="text-green-600" />
                  <span className="text-sm text-gray-800">{g.name}</span>
                </label>
              ))}
              {groups.length === 0 && <p className="text-sm text-gray-400">Belum ada grup. Buat grup terlebih dahulu.</p>}
            </div>
          )}

          <div className="flex justify-end">
            <button onClick={() => { setError(''); setStep(2); }} className="px-5 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700">Lanjut →</button>
          </div>
        </div>
      )}

      {/* Step 2: Pesan */}
      {step === 2 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
          <h2 className="font-semibold text-gray-900">Langkah 2: Isi Pesan</h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Judul Broadcast *</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="input" placeholder="PPDB 2026, Promo Ramadan, dll" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Gunakan Template (opsional)</label>
            <select value={templateId} onChange={(e) => handleTemplateSelect(e.target.value)} className="input">
              <option value="">— Tulis manual —</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Isi Pesan *</label>
            <p className="text-xs text-gray-400 mb-1">Gunakan <code className="bg-gray-100 px-1 rounded">{'{{nama}}'}</code> untuk personalisasi</p>
            <textarea value={messageBody} onChange={(e) => setMessageBody(e.target.value)} className="input font-mono" rows={6} placeholder={'Assalamualaikum {{nama}},\n\nKami ingin menginformasikan...'} />
          </div>

          {messageBody && (
            <div>
              <p className="text-xs text-gray-400 mb-1">Pratinjau:</p>
              <div className="bg-green-50 rounded-lg p-3 text-sm whitespace-pre-wrap">{preview(messageBody)}</div>
            </div>
          )}

          <div className="flex justify-between">
            <button onClick={() => setStep(1)} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">← Kembali</button>
            <button onClick={() => { setError(''); setStep(3); }} className="px-5 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700">Lanjut →</button>
          </div>
        </div>
      )}

      {/* Step 3: Jadwal & Konfirmasi */}
      {step === 3 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
          <h2 className="font-semibold text-gray-900">Langkah 3: Jadwal & Konfirmasi</h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sesi WhatsApp *</label>
            {sessions.length === 0 ? (
              <p className="text-sm text-red-500">Tidak ada sesi WA yang terhubung. Hubungkan sesi terlebih dahulu.</p>
            ) : (
              <select value={sessionId} onChange={(e) => setSessionId(e.target.value)} className="input">
                {sessions.map((s) => <option key={s.id} value={s.id}>{s.display_name ?? s.phone_number ?? s.session_key}</option>)}
              </select>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Waktu Kirim</label>
            <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="input" />
            <p className="text-xs text-gray-400 mt-1">Kosongkan untuk kirim sekarang</p>
          </div>

          {/* Summary */}
          <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Judul</span><span className="font-medium text-gray-900">{title}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Penerima</span><span className="font-medium text-gray-900 capitalize">{recipientType === 'all' ? 'Semua Kontak' : recipientType === 'group' ? `${selectedGroups.length} Grup` : 'Manual'}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Waktu</span><span className="font-medium text-gray-900">{scheduledAt ? new Date(scheduledAt).toLocaleString('id-ID') : 'Segera'}</span></div>
          </div>

          <div className="flex justify-between">
            <button onClick={() => setStep(2)} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">← Kembali</button>
            <button onClick={handleSubmit} disabled={loading || sessions.length === 0} className="px-5 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-60">
              {loading ? 'Mengirim...' : scheduledAt ? '📅 Jadwalkan' : '🚀 Kirim Sekarang'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
