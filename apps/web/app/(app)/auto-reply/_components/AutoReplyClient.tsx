'use client';

import { useState } from 'react';
import { createClient } from '@/src/lib/supabase/client';

interface Trigger { id: string; keyword: string; }
interface Rule { id: string; name: string; response_text: string; is_active: boolean; is_greeting: boolean; triggers: Trigger[]; }

export default function AutoReplyClient({ initialRules }: { initialRules: Rule[] }) {
  const [rules, setRules] = useState(initialRules);
  const [showModal, setShowModal] = useState(false);
  const [editRule, setEditRule] = useState<Rule | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  async function handleToggle(id: string, current: boolean) {
    const supabase = createClient();
    await supabase.from('keyword_rules').update({ is_active: !current, updated_at: new Date().toISOString() }).eq('id', id);
    setRules((prev) => prev.map((r) => r.id === id ? { ...r, is_active: !current } : r));
  }

  async function handleDelete(id: string) {
    const supabase = createClient();
    await supabase.from('keyword_rules').delete().eq('id', id);
    setRules((prev) => prev.filter((r) => r.id !== id));
    setDeleteConfirm(null);
  }

  async function handleSave(data: Omit<Rule, 'id' | 'triggers'> & { keywords: string[] }, id?: string) {
    const supabase = createClient();
    const payload = { name: data.name, response_text: data.response_text, is_active: data.is_active, is_greeting: data.is_greeting };

    if (id) {
      await supabase.from('keyword_rules').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', id);
      await supabase.from('keyword_triggers').delete().eq('rule_id', id);
      await supabase.from('keyword_triggers').insert(data.keywords.map((k) => ({ rule_id: id, keyword: k.toLowerCase() })));
      setRules((prev) => prev.map((r) => r.id === id ? { ...r, ...payload, triggers: data.keywords.map((k, i) => ({ id: String(i), keyword: k })) } : r));
    } else {
      const { data: newRule } = await supabase.from('keyword_rules').insert(payload).select().single();
      if (newRule) {
        await supabase.from('keyword_triggers').insert(data.keywords.map((k) => ({ rule_id: newRule.id, keyword: k.toLowerCase() })));
        setRules((prev) => [{ ...newRule, triggers: data.keywords.map((k, i) => ({ id: String(i), keyword: k })) }, ...prev]);
      }
    }
    setShowModal(false);
    setEditRule(null);
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Auto Reply</h1>
          <p className="text-sm text-gray-500 mt-0.5">Balas otomatis berdasarkan keyword dari pesan masuk</p>
        </div>
        <button onClick={() => { setEditRule(null); setShowModal(true); }} className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700">+ Tambah Rule</button>
      </div>

      <div className="space-y-3">
        {rules.length === 0 && <p className="text-sm text-gray-400">Belum ada rule auto reply.</p>}
        {rules.map((r) => (
          <div key={r.id} className={`bg-white rounded-xl border p-4 space-y-3 ${r.is_active ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-gray-900">{r.name}</h3>
                  {r.is_greeting && <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">Greeting</span>}
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${r.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{r.is_active ? 'Aktif' : 'Nonaktif'}</span>
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {r.triggers.map((t) => <span key={t.id} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-mono">{t.keyword}</span>)}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => handleToggle(r.id, r.is_active)} className="text-xs px-2 py-1 border rounded hover:bg-gray-50 transition-colors">{r.is_active ? 'Nonaktifkan' : 'Aktifkan'}</button>
                <button onClick={() => { setEditRule(r); setShowModal(true); }} className="text-xs px-2 py-1 border rounded hover:bg-gray-50 transition-colors">Edit</button>
                <button onClick={() => setDeleteConfirm(r.id)} className="text-xs px-2 py-1 border border-red-200 text-red-600 rounded hover:bg-red-50 transition-colors">Hapus</button>
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-700 whitespace-pre-wrap">{r.response_text}</div>
          </div>
        ))}
      </div>

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full">
            <h3 className="font-semibold text-gray-900 mb-2">Hapus Rule?</h3>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm border rounded-lg">Batal</button>
              <button onClick={() => handleDelete(deleteConfirm)} className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg">Hapus</button>
            </div>
          </div>
        </div>
      )}

      {showModal && <RuleModal rule={editRule} onClose={() => { setShowModal(false); setEditRule(null); }} onSave={handleSave} />}
    </div>
  );
}

function RuleModal({ rule, onClose, onSave }: {
  rule: Rule | null;
  onClose: () => void;
  onSave: (data: Omit<Rule, 'id' | 'triggers'> & { keywords: string[] }, id?: string) => Promise<void>;
}) {
  const [name, setName] = useState(rule?.name ?? '');
  const [responseText, setResponseText] = useState(rule?.response_text ?? '');
  const [isGreeting, setIsGreeting] = useState(rule?.is_greeting ?? false);
  const [isActive, setIsActive] = useState(rule?.is_active ?? true);
  const [keywordInput, setKeywordInput] = useState('');
  const [keywords, setKeywords] = useState<string[]>(rule?.triggers.map((t) => t.keyword) ?? []);
  const [loading, setLoading] = useState(false);

  function addKeyword() {
    const kw = keywordInput.trim().toLowerCase();
    if (kw && !keywords.includes(kw)) setKeywords((prev) => [...prev, kw]);
    setKeywordInput('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await onSave({ name, response_text: responseText, is_active: isActive, is_greeting: isGreeting, keywords }, rule?.id);
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b">
          <h2 className="text-base font-semibold">{rule ? 'Edit Rule' : 'Tambah Rule'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nama Rule *</label>
            <input required value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="Info sekolah" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Keyword Pemicu</label>
            <div className="flex gap-2">
              <input value={keywordInput} onChange={(e) => setKeywordInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addKeyword(); } }} className="input flex-1" placeholder="info, halo, menu..." />
              <button type="button" onClick={addKeyword} className="px-3 py-2 bg-gray-100 text-sm rounded-lg hover:bg-gray-200">Tambah</button>
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              {keywords.map((k) => (
                <span key={k} className="flex items-center gap-1 text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-mono">
                  {k}
                  <button type="button" onClick={() => setKeywords((prev) => prev.filter((kw) => kw !== k))} className="text-blue-400 hover:text-blue-700">×</button>
                </span>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Teks Balasan *</label>
            <textarea required value={responseText} onChange={(e) => setResponseText(e.target.value)} className="input" rows={4}
              placeholder={'Terima kasih sudah menghubungi kami.\nKetik:\n1. Biaya\n2. Pendaftaran\n3. Lokasi'} />
          </div>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={isGreeting} onChange={(e) => setIsGreeting(e.target.checked)} className="text-green-600" />
              Pesan Sambutan (dikirim sekali per kontak)
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="text-green-600" />
              Aktif
            </label>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg">Batal</button>
            <button type="submit" disabled={loading} className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg disabled:opacity-60">{loading ? 'Menyimpan...' : 'Simpan'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
