'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/src/lib/supabase/client';
import { validateWaNumber, sanitizeWaNumber } from '@/src/lib/utils/contacts';

interface Contact {
  id: string;
  full_name: string;
  wa_number: string;
  category: string | null;
  status: 'active' | 'inactive';
  notes: string | null;
  joined_at: string;
}

interface Group {
  id: string;
  name: string;
}

interface ContactsClientProps {
  initialPage: number;
  pageSize: number;
  groups: Group[];
  initialSearch: string;
  initialStatus: string;
  initialGroupId: string;
}

export default function ContactsClient({ initialPage, pageSize, groups, initialSearch, initialStatus, initialGroupId }: ContactsClientProps) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(initialPage);
  const [search, setSearch] = useState(initialSearch);
  const [status, setStatus] = useState(initialStatus);
  const [groupId, setGroupId] = useState(initialGroupId);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    let query = supabase.from('contacts').select('id, full_name, wa_number, category, status, notes, joined_at', { count: 'exact' });

    if (search) query = query.or(`full_name.ilike.%${search}%,wa_number.ilike.%${search}%`);
    if (status) query = query.eq('status', status);
    if (groupId) {
      const { data: members } = await supabase.from('contact_group_members').select('contact_id').eq('group_id', groupId);
      const ids = members?.map((m) => m.contact_id) ?? [];
      if (ids.length === 0) { setContacts([]); setTotal(0); setLoading(false); return; }
      query = query.in('id', ids);
    }

    const { data, count, error } = await query.order('created_at', { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
    if (!error) { setContacts(data ?? []); setTotal(count ?? 0); }
    setLoading(false);
  }, [page, search, status, groupId, pageSize]);

  useEffect(() => { fetchContacts(); }, [fetchContacts]);

  async function handleDelete(id: string) {
    const supabase = createClient();
    await supabase.from('contacts').delete().eq('id', id);
    setDeleteConfirm(null);
    fetchContacts();
  }

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Manajemen Kontak</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total.toLocaleString('id-ID')} kontak</p>
        </div>
        <button onClick={() => { setEditContact(null); setShowModal(true); }} className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 transition-colors">+ Tambah Kontak</button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Cari nama atau nomor..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 w-64"
        />
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
          <option value="">Semua Status</option>
          <option value="active">Aktif</option>
          <option value="inactive">Nonaktif</option>
        </select>
        <select value={groupId} onChange={(e) => { setGroupId(e.target.value); setPage(1); }} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
          <option value="">Semua Grup</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50">
            <tr>
              {['Nama', 'Nomor WA', 'Kategori', 'Status', 'Tanggal Masuk', 'Aksi'].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">Memuat...</td></tr>
            ) : contacts.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">Tidak ada kontak ditemukan.</td></tr>
            ) : contacts.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 text-sm font-medium text-gray-900">{c.full_name}</td>
                <td className="px-4 py-3 text-sm text-gray-600 font-mono">{c.wa_number}</td>
                <td className="px-4 py-3 text-sm text-gray-500">{c.category ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${c.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {c.status === 'active' ? 'Aktif' : 'Nonaktif'}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">{new Date(c.joined_at).toLocaleDateString('id-ID')}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button onClick={() => { setEditContact(c); setShowModal(true); }} className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 transition-colors">Edit</button>
                    <button onClick={() => setDeleteConfirm(c.id)} className="text-xs px-2 py-1 border border-red-200 text-red-600 rounded hover:bg-red-50 transition-colors">Hapus</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">Halaman {page} dari {totalPages}</p>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1.5 text-sm border rounded disabled:opacity-40 hover:bg-gray-50 transition-colors">← Sebelumnya</button>
            <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="px-3 py-1.5 text-sm border rounded disabled:opacity-40 hover:bg-gray-50 transition-colors">Berikutnya →</button>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full">
            <h3 className="text-base font-semibold text-gray-900 mb-2">Hapus Kontak?</h3>
            <p className="text-sm text-gray-500 mb-5">Tindakan ini tidak dapat dibatalkan.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50 transition-colors">Batal</button>
              <button onClick={() => handleDelete(deleteConfirm)} className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors">Hapus</button>
            </div>
          </div>
        </div>
      )}

      {/* Contact Form Modal */}
      {showModal && (
        <ContactFormModal
          contact={editContact}
          onClose={() => setShowModal(false)}
          onSave={() => { setShowModal(false); fetchContacts(); }}
        />
      )}
    </div>
  );
}

function ContactFormModal({ contact, onClose, onSave }: { contact: Contact | null; onClose: () => void; onSave: () => void }) {
  const [values, setValues] = useState({ full_name: contact?.full_name ?? '', wa_number: contact?.wa_number ?? '', category: contact?.category ?? '', status: contact?.status ?? 'active', notes: contact?.notes ?? '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validateWaNumber(values.wa_number)) { setError('Format nomor WA tidak valid. Gunakan format internasional (628xxx).'); return; }
    const sanitized = sanitizeWaNumber(values.wa_number);
    setLoading(true);
    setError('');
    const supabase = createClient();
    const payload = { full_name: values.full_name, wa_number: sanitized, category: values.category || null, status: values.status as 'active' | 'inactive', notes: values.notes || null };
    const { error: dbError } = contact
      ? await supabase.from('contacts').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', contact.id)
      : await supabase.from('contacts').insert(payload);
    if (dbError) { setError(dbError.code === '23505' ? 'Nomor WA sudah terdaftar.' : dbError.message); setLoading(false); return; }
    onSave();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b">
          <h2 className="text-base font-semibold text-gray-900">{contact ? 'Edit Kontak' : 'Tambah Kontak'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>}
          <Field label="Nama Lengkap" required><input required value={values.full_name} onChange={(e) => setValues({ ...values, full_name: e.target.value })} className="input" /></Field>
          <Field label="Nomor WhatsApp" required hint="Format: 628xxxxxxxx"><input required value={values.wa_number} onChange={(e) => setValues({ ...values, wa_number: e.target.value })} className="input" placeholder="628xxxxxxxx" /></Field>
          <Field label="Kategori"><input value={values.category} onChange={(e) => setValues({ ...values, category: e.target.value })} className="input" placeholder="Orang Tua, Customer, dll" /></Field>
          <Field label="Status">
            <select value={values.status} onChange={(e) => setValues({ ...values, status: e.target.value as 'active' | 'inactive' })} className="input">
              <option value="active">Aktif</option>
              <option value="inactive">Nonaktif</option>
            </select>
          </Field>
          <Field label="Catatan"><textarea value={values.notes} onChange={(e) => setValues({ ...values, notes: e.target.value })} className="input" rows={2} /></Field>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Batal</button>
            <button type="submit" disabled={loading} className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-60">{loading ? 'Menyimpan...' : 'Simpan'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      {children}
      {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
    </div>
  );
}
