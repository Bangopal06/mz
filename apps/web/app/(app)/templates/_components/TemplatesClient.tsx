'use client';

import { useState } from 'react';
import { createClient } from '@/src/lib/supabase/client';
import { resolveTemplate, extractTemplateVars } from '@/src/lib/utils/template';

interface Template { id: string; title: string; body: string; created_at: string; }

const SAMPLE_CONTACT = { full_name: 'Ahmad', wa_number: '6281234567890', nama: 'Ahmad', nomor: '6281234567890' };

function resolvePreview(body: string) {
  return resolveTemplate(body, SAMPLE_CONTACT);
}

export default function TemplatesClient({ initialTemplates }: { initialTemplates: Template[] }) {
  const [templates, setTemplates] = useState(initialTemplates);
  const [showModal, setShowModal] = useState(false);
  const [editTemplate, setEditTemplate] = useState<Template | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  async function handleDelete(id: string) {
    const supabase = createClient();
    await supabase.from('message_templates').delete().eq('id', id);
    setTemplates((prev) => prev.filter((t) => t.id !== id));
    setDeleteConfirm(null);
  }

  async function handleSave(title: string, body: string, id?: string) {
    const supabase = createClient();
    if (id) {
      const { data } = await supabase.from('message_templates').update({ title, body, updated_at: new Date().toISOString() }).eq('id', id).select().single();
      if (data) setTemplates((prev) => prev.map((t) => t.id === id ? data : t));
    } else {
      const { data } = await supabase.from('message_templates').insert({ title, body }).select().single();
      if (data) setTemplates((prev) => [data, ...prev]);
    }
    setShowModal(false);
    setEditTemplate(null);
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Template Pesan</h1>
        <button onClick={() => { setEditTemplate(null); setShowModal(true); }} className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 transition-colors">+ Tambah Template</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {templates.length === 0 && <p className="text-sm text-gray-400">Belum ada template.</p>}
        {templates.map((t) => (
          <div key={t.id} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-semibold text-gray-900 leading-tight">{t.title}</h3>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => { setEditTemplate(t); setShowModal(true); }} className="text-xs px-2 py-1 border rounded hover:bg-gray-50">Edit</button>
                <button onClick={() => setDeleteConfirm(t.id)} className="text-xs px-2 py-1 border border-red-200 text-red-600 rounded hover:bg-red-50">Hapus</button>
              </div>
            </div>
            <div className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap line-clamp-3">{t.body}</div>
            <div>
              <p className="text-xs text-gray-400 mb-1">Pratinjau:</p>
              <div className="text-sm text-gray-700 bg-green-50 rounded-lg p-3 whitespace-pre-wrap line-clamp-3">{resolvePreview(t.body)}</div>
            </div>
          </div>
        ))}
      </div>

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full">
            <h3 className="font-semibold text-gray-900 mb-2">Hapus Template?</h3>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm border rounded-lg">Batal</button>
              <button onClick={() => handleDelete(deleteConfirm)} className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg">Hapus</button>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <TemplateModal template={editTemplate} onClose={() => { setShowModal(false); setEditTemplate(null); }} onSave={handleSave} />
      )}
    </div>
  );
}

function TemplateModal({ template, onClose, onSave }: { template: Template | null; onClose: () => void; onSave: (title: string, body: string, id?: string) => Promise<void> }) {
  const [title, setTitle] = useState(template?.title ?? '');
  const [body, setBody] = useState(template?.body ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) { setError('Isi pesan tidak boleh kosong.'); return; }
    setLoading(true);
    await onSave(title, body, template?.id);
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b">
          <h2 className="text-base font-semibold">{template ? 'Edit Template' : 'Buat Template'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded-lg">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Judul *</label>
            <input required value={title} onChange={(e) => setTitle(e.target.value)} className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" placeholder="PPDB 2026" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Isi Pesan *</label>
            <p className="text-xs text-gray-400 mb-1">Gunakan <code className="bg-gray-100 px-1 rounded">{'{{nama}}'}</code> dan <code className="bg-gray-100 px-1 rounded">{'{{nomor}}'}</code> untuk personalisasi</p>
            <textarea required value={body} onChange={(e) => { setBody(e.target.value); setError(''); }} className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500" rows={6} placeholder={'Assalamualaikum {{nama}},\n\nKami ingin menginformasikan...'} />
            {body && extractTemplateVars(body).length > 0 && (
              <p className="text-xs text-gray-400 mt-1">
                Variabel terdeteksi: {extractTemplateVars(body).map((v) => (
                  <code key={v} className="bg-gray-100 px-1 rounded mx-0.5">{`{{${v}}}`}</code>
                ))}
              </p>
            )}
          </div>
          {body && (
            <div>
              <p className="text-xs text-gray-400 mb-1">Pratinjau dengan data contoh:</p>
              <div className="bg-green-50 rounded-lg p-3 text-sm whitespace-pre-wrap">{resolvePreview(body)}</div>
            </div>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg">Batal</button>
            <button type="submit" disabled={loading} className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg disabled:opacity-60">{loading ? 'Menyimpan...' : 'Simpan'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
