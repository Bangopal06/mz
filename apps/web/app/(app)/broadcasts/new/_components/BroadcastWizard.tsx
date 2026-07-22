'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/src/lib/supabase/client';
import MediaUploader, { type MediaAttachment } from '@/src/components/MediaUploader';

interface Group { id: string; name: string }
interface Template { id: string; title: string; body: string }
interface Session { id: string; session_key: string; phone_number: string | null; display_name: string | null; status: string }
interface Contact { id: string; full_name: string; wa_number: string }

const SAMPLE = { nama: 'Ahmad', nomor: '6281234567890' };
function previewTemplate(body: string) {
  return body
    .replace(/\{\{nama\}\}/g, SAMPLE.nama)
    .replace(/\{\{nomor\}\}/g, SAMPLE.nomor);
}

export default function BroadcastWizard({
  groups,
  templates,
  sessions,
}: {
  groups: Group[]
  templates: Template[]
  sessions: Session[]
}) {
  const router = useRouter();
  const [step, setStep] = useState(1);

  // Step 1 — recipients
  const [recipientType, setRecipientType] = useState<'all' | 'group' | 'manual'>('all');
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  // For manual: load contacts on demand
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactSearch, setContactSearch] = useState('');
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);

  // Step 2 — message
  const [title, setTitle] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [attachment, setAttachment] = useState<MediaAttachment | null>(null);
  const [mediaCaption, setMediaCaption] = useState('');

  // Step 3 — schedule & session
  const [sessionId, setSessionId] = useState(sessions[0]?.id ?? '');
  const [scheduledAt, setScheduledAt] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function toggleGroup(id: string) {
    setSelectedGroups((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]
    );
  }

  function toggleContact(id: string) {
    setSelectedContacts((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  }

  async function loadContacts() {
    setLoadingContacts(true);
    const supabase = createClient();
    const { data } = await supabase
      .from('contacts')
      .select('id, full_name, wa_number')
      .eq('status', 'active')
      .order('full_name');
    setContacts(data ?? []);
    setLoadingContacts(false);
  }

  function handleRecipientTypeChange(type: 'all' | 'group' | 'manual') {
    setRecipientType(type);
    if (type === 'manual' && contacts.length === 0) loadContacts();
  }

  function handleTemplateSelect(id: string) {
    setTemplateId(id);
    const t = templates.find((t) => t.id === id);
    if (t) setMessageBody(t.body);
  }

  function goNext(next: number) {
    setError('');
    if (step === 1) {
      if (recipientType === 'group' && selectedGroups.length === 0) {
        setError('Pilih minimal satu grup.');
        return;
      }
      if (recipientType === 'manual' && selectedContacts.length === 0) {
        setError('Pilih minimal satu kontak.');
        return;
      }
    }
    if (step === 2) {
      if (!title.trim()) { setError('Judul broadcast wajib diisi.'); return; }
      if (!messageBody.trim()) { setError('Isi pesan wajib diisi.'); return; }
    }
    setStep(next);
  }

  async function handleSubmit() {
    if (!sessionId) { setError('Pilih sesi WhatsApp.'); return; }

    setLoading(true);
    setError('');

    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();

      const payload: Record<string, unknown> = {
        title,
        message_body: messageBody,
        template_id: templateId || null,
        attachment_id: attachment?.id ?? null,
        recipient_type: recipientType,
        wa_session_id: sessionId,
        scheduled_at: scheduledAt || null,
      };

      if (recipientType === 'group') payload.group_ids = selectedGroups;
      if (recipientType === 'manual') payload.contact_ids = selectedContacts;

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/broadcasts`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token ?? ''}`,
            apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
          },
          body: JSON.stringify(payload),
        }
      );

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error ?? 'Gagal membuat broadcast.');
      }

      // If immediate broadcast, enqueue via Next.js proxy (Supabase Edge Function
      // cannot reach localhost gateway, so we call the local API route instead)
      if (!scheduledAt && result.broadcast_id) {
        await fetch('/api/gateway/broadcast/enqueue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            broadcast_id: result.broadcast_id,
            session_id: sessionId,
          }),
        }).catch(() => {
          // Non-fatal: broadcast is saved as paused, can be resumed manually
          console.warn('Gateway enqueue failed, broadcast saved as paused');
        });
      }

      router.push(`/broadcasts/${result.broadcast_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan.');
      setLoading(false);
    }
  }

  const filteredContacts = contacts.filter(
    (c) =>
      c.full_name.toLowerCase().includes(contactSearch.toLowerCase()) ||
      c.wa_number.includes(contactSearch)
  );

  const recipientSummary =
    recipientType === 'all'
      ? 'Semua Kontak Aktif'
      : recipientType === 'group'
      ? `${selectedGroups.length} Grup`
      : `${selectedContacts.length} Kontak`;

  return (
    <div className="p-6 max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Broadcast Baru</h1>
        <div className="flex items-center gap-2">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-1">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${
                  s < step
                    ? 'bg-green-600 border-green-600 text-white'
                    : s === step
                    ? 'border-green-600 text-green-600 bg-white'
                    : 'border-gray-200 text-gray-400 bg-white'
                }`}
              >
                {s < step ? '✓' : s}
              </div>
              {s < 3 && <div className={`w-8 h-0.5 ${s < step ? 'bg-green-600' : 'bg-gray-200'}`} />}
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded-lg">
          {error}
        </div>
      )}

      {/* ── Step 1: Penerima ── */}
      {step === 1 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
          <h2 className="font-semibold text-gray-800">Langkah 1 — Pilih Penerima</h2>

          <div className="space-y-2">
            {(
              [
                { value: 'all', label: 'Semua Kontak Aktif', desc: 'Kirim ke semua kontak dengan status aktif' },
                { value: 'group', label: 'Grup Tertentu', desc: 'Pilih satu atau lebih grup kontak' },
                { value: 'manual', label: 'Pilih Manual', desc: 'Centang kontak satu per satu' },
              ] as const
            ).map((opt) => (
              <label
                key={opt.value}
                className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                  recipientType === opt.value
                    ? 'border-green-500 bg-green-50'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  value={opt.value}
                  checked={recipientType === opt.value}
                  onChange={() => handleRecipientTypeChange(opt.value)}
                  className="mt-0.5 text-green-600"
                />
                <div>
                  <p className="text-sm font-medium text-gray-900">{opt.label}</p>
                  <p className="text-xs text-gray-500">{opt.desc}</p>
                </div>
              </label>
            ))}
          </div>

          {/* Group selection */}
          {recipientType === 'group' && (
            <div className="space-y-2 pt-1">
              <p className="text-sm font-medium text-gray-700">Pilih Grup:</p>
              {groups.length === 0 ? (
                <p className="text-sm text-gray-400">Belum ada grup. Buat grup terlebih dahulu.</p>
              ) : (
                groups.map((g) => (
                  <label
                    key={g.id}
                    className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                      selectedGroups.includes(g.id) ? 'border-green-400 bg-green-50' : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedGroups.includes(g.id)}
                      onChange={() => toggleGroup(g.id)}
                      className="text-green-600"
                    />
                    <span className="text-sm text-gray-800">{g.name}</span>
                  </label>
                ))
              )}
            </div>
          )}

          {/* Manual contact selection */}
          {recipientType === 'manual' && (
            <div className="space-y-2 pt-1">
              <input
                type="text"
                value={contactSearch}
                onChange={(e) => setContactSearch(e.target.value)}
                placeholder="Cari nama atau nomor..."
                className="input text-sm"
              />
              {loadingContacts ? (
                <p className="text-sm text-gray-400">Memuat kontak...</p>
              ) : (
                <div className="max-h-56 overflow-y-auto space-y-1 border rounded-lg p-1">
                  {filteredContacts.map((c) => (
                    <label
                      key={c.id}
                      className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${
                        selectedContacts.includes(c.id) ? 'bg-green-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedContacts.includes(c.id)}
                        onChange={() => toggleContact(c.id)}
                        className="text-green-600"
                      />
                      <div>
                        <p className="text-sm font-medium text-gray-800">{c.full_name}</p>
                        <p className="text-xs text-gray-400">{c.wa_number}</p>
                      </div>
                    </label>
                  ))}
                  {filteredContacts.length === 0 && (
                    <p className="text-sm text-gray-400 p-2">Tidak ada kontak.</p>
                  )}
                </div>
              )}
              {selectedContacts.length > 0 && (
                <p className="text-xs text-green-700 font-medium">{selectedContacts.length} kontak dipilih</p>
              )}
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button
              onClick={() => goNext(2)}
              className="px-5 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700"
            >
              Lanjut →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Pesan ── */}
      {step === 2 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
          <h2 className="font-semibold text-gray-800">Langkah 2 — Isi Pesan</h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Judul Broadcast *</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="input"
              placeholder="PPDB 2026, Promo Ramadan, dll"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Gunakan Template <span className="text-gray-400 font-normal">(opsional)</span>
            </label>
            <select
              value={templateId}
              onChange={(e) => handleTemplateSelect(e.target.value)}
              className="input"
            >
              <option value="">— Tulis manual —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Isi Pesan *</label>
            <p className="text-xs text-gray-400 mb-1">
              Gunakan <code className="bg-gray-100 px-1 rounded">{`{{nama}}`}</code> dan{' '}
              <code className="bg-gray-100 px-1 rounded">{`{{nomor}}`}</code> untuk personalisasi
            </p>
            <textarea
              value={messageBody}
              onChange={(e) => setMessageBody(e.target.value)}
              className="input font-mono text-sm"
              rows={6}
              placeholder={'Assalamualaikum {{nama}},\n\nKami ingin menginformasikan...'}
            />
          </div>

          {messageBody && (
            <div>
              <p className="text-xs text-gray-500 mb-1 font-medium">Pratinjau pesan:</p>
              <div className="bg-green-50 border border-green-100 rounded-lg p-3 text-sm whitespace-pre-wrap text-gray-800">
                {previewTemplate(messageBody)}
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Lampiran Media <span className="text-gray-400 font-normal">(opsional)</span>
            </label>
            <MediaUploader
              value={attachment}
              onChange={setAttachment}
              caption={mediaCaption}
              onCaptionChange={setMediaCaption}
            />
          </div>

          <div className="flex justify-between pt-2">
            <button onClick={() => setStep(1)} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">
              ← Kembali
            </button>
            <button
              onClick={() => goNext(3)}
              className="px-5 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700"
            >
              Lanjut →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Jadwal & Konfirmasi ── */}
      {step === 3 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
          <h2 className="font-semibold text-gray-800">Langkah 3 — Jadwal & Konfirmasi</h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sesi WhatsApp *</label>
            {sessions.length === 0 ? (
              <p className="text-sm text-red-500">
                Tidak ada sesi WA yang terhubung. Hubungkan sesi terlebih dahulu.
              </p>
            ) : (
              <select
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                className="input"
              >
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.display_name ?? s.phone_number ?? s.session_key}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Waktu Kirim</label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="input"
            />
            <p className="text-xs text-gray-400 mt-1">Kosongkan untuk kirim sekarang</p>
          </div>

          {/* Summary */}
          <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm border border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Ringkasan</p>
            {[
              { label: 'Judul', value: title },
              { label: 'Penerima', value: recipientSummary },
              { label: 'Pesan', value: messageBody.slice(0, 60) + (messageBody.length > 60 ? '…' : '') },
              ...(attachment ? [{ label: 'Media', value: attachment.original_name }] : []),
              { label: 'Waktu', value: scheduledAt ? new Date(scheduledAt).toLocaleString('id-ID') : 'Segera' },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between gap-4">
                <span className="text-gray-500 shrink-0">{label}</span>
                <span className="font-medium text-gray-900 text-right">{value}</span>
              </div>
            ))}
          </div>

          <div className="flex justify-between pt-2">
            <button onClick={() => setStep(2)} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">
              ← Kembali
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading || sessions.length === 0}
              className="px-5 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-60 flex items-center gap-2"
            >
              {loading
                ? 'Memproses...'
                : scheduledAt
                ? '📅 Jadwalkan Broadcast'
                : '🚀 Kirim Sekarang'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
