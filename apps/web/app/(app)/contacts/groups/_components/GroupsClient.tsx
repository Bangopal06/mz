'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/src/lib/supabase/client';

interface Group {
  id: string;
  name: string;
  description: string | null;
  member_count: number;
}

interface Contact {
  id: string;
  full_name: string;
  wa_number: string;
}

export default function GroupsClient({ initialGroups }: { initialGroups: Group[] }) {
  const [groups, setGroups] = useState(initialGroups);
  const [showModal, setShowModal] = useState(false);
  const [editGroup, setEditGroup] = useState<Group | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [managingGroup, setManagingGroup] = useState<Group | null>(null);

  async function handleDelete(id: string) {
    const supabase = createClient();
    await supabase.from('contact_groups').delete().eq('id', id);
    setGroups((prev) => prev.filter((g) => g.id !== id));
    setDeleteConfirm(null);
  }

  async function handleSave(name: string, description: string, id?: string) {
    const supabase = createClient();
    if (id) {
      const { data } = await supabase
        .from('contact_groups')
        .update({ name, description: description || null, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (data) setGroups((prev) => prev.map((g) => g.id === id ? { ...g, name: data.name, description: data.description } : g));
    } else {
      const { data } = await supabase
        .from('contact_groups')
        .insert({ name, description: description || null })
        .select()
        .single();
      if (data) setGroups((prev) => [...prev, { ...data, member_count: 0 }]);
    }
    setShowModal(false);
    setEditGroup(null);
  }

  function handleMemberCountChange(groupId: string, delta: number) {
    setGroups((prev) => prev.map((g) => g.id === groupId ? { ...g, member_count: Math.max(0, g.member_count + delta) } : g));
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Grup Kontak</h1>
        <button
          onClick={() => { setEditGroup(null); setShowModal(true); }}
          className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 transition-colors"
        >
          + Buat Grup
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {groups.length === 0 && <p className="text-sm text-gray-400 col-span-3">Belum ada grup.</p>}
        {groups.map((g) => (
          <div key={g.id} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">{g.name}</h3>
                {g.description && <p className="text-sm text-gray-500 mt-0.5">{g.description}</p>}
              </div>
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full font-medium">
                {g.member_count} anggota
              </span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setManagingGroup(g)}
                className="text-xs px-3 py-1.5 border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
              >
                Anggota
              </button>
              <button
                onClick={() => { setEditGroup(g); setShowModal(true); }}
                className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Edit
              </button>
              <button
                onClick={() => setDeleteConfirm(g.id)}
                className="text-xs px-3 py-1.5 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
              >
                Hapus
              </button>
            </div>
          </div>
        ))}
      </div>

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full">
            <h3 className="font-semibold text-gray-900 mb-2">Hapus Grup?</h3>
            <p className="text-sm text-gray-500 mb-2">
              Grup akan dihapus. <strong>Kontak di dalamnya tidak akan ikut terhapus.</strong>
            </p>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Batal</button>
              <button onClick={() => handleDelete(deleteConfirm)} className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700">Hapus</button>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <GroupFormModal
          group={editGroup}
          onClose={() => { setShowModal(false); setEditGroup(null); }}
          onSave={handleSave}
        />
      )}

      {managingGroup && (
        <MembersModal
          group={managingGroup}
          onClose={() => setManagingGroup(null)}
          onCountChange={(delta) => handleMemberCountChange(managingGroup.id, delta)}
        />
      )}
    </div>
  );
}

function GroupFormModal({
  group,
  onClose,
  onSave,
}: {
  group: Group | null;
  onClose: () => void;
  onSave: (name: string, desc: string, id?: string) => Promise<void>;
}) {
  const [name, setName] = useState(group?.name ?? '');
  const [desc, setDesc] = useState(group?.description ?? '');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await onSave(name, desc, group?.id);
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">{group ? 'Edit Grup' : 'Buat Grup Baru'}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nama Grup *</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="Orang Tua Siswa"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Deskripsi</label>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              rows={2}
            />
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Batal</button>
            <button type="submit" disabled={loading} className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-60">
              {loading ? 'Menyimpan...' : 'Simpan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MembersModal({
  group,
  onClose,
  onCountChange,
}: {
  group: Group;
  onClose: () => void;
  onCountChange: (delta: number) => void;
}) {
  const [members, setMembers] = useState<Contact[]>([]);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Contact[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const fetchMembers = useCallback(async () => {
    setLoadingMembers(true);
    const supabase = createClient();
    const { data } = await supabase
      .from('contact_group_members')
      .select('contact_id, contacts(id, full_name, wa_number)')
      .eq('group_id', group.id);
    const contacts = (data ?? []).map((m) => m.contacts as unknown as Contact).filter(Boolean);
    setMembers(contacts);
    setLoadingMembers(false);
  }, [group.id]);

  useEffect(() => { fetchMembers(); }, [fetchMembers]);

  useEffect(() => {
    if (!search.trim()) { setSearchResults([]); return; }
    const timer = setTimeout(async () => {
      setSearching(true);
      const supabase = createClient();
      const { data } = await supabase
        .from('contacts')
        .select('id, full_name, wa_number')
        .or(`full_name.ilike.%${search}%,wa_number.ilike.%${search}%`)
        .eq('status', 'active')
        .limit(20);
      const memberIds = new Set(members.map((m) => m.id));
      setSearchResults((data ?? []).filter((c) => !memberIds.has(c.id)));
      setSearching(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, members]);

  async function handleAddSelected() {
    if (selected.size === 0) return;
    const supabase = createClient();
    const inserts = Array.from(selected).map((contact_id) => ({ group_id: group.id, contact_id }));
    await supabase.from('contact_group_members').insert(inserts);
    onCountChange(selected.size);
    setSelected(new Set());
    setSearch('');
    setSearchResults([]);
    fetchMembers();
  }

  async function handleRemoveMember(contactId: string) {
    const supabase = createClient();
    await supabase.from('contact_group_members').delete().eq('group_id', group.id).eq('contact_id', contactId);
    onCountChange(-1);
    setMembers((prev) => prev.filter((m) => m.id !== contactId));
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Anggota: {group.name}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{members.length} anggota</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
        </div>

        {/* Add members section */}
        <div className="px-6 py-4 border-b space-y-2">
          <p className="text-sm font-medium text-gray-700">Tambah Kontak ke Grup</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama atau nomor..."
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <button
              onClick={handleAddSelected}
              disabled={selected.size === 0}
              className="px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              + Tambah {selected.size > 0 ? `(${selected.size})` : ''}
            </button>
          </div>
          {(searchResults.length > 0 || searching) && (
            <div className="border border-gray-200 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
              {searching && <p className="text-xs text-gray-400 px-3 py-2">Mencari...</p>}
              {searchResults.map((c) => (
                <label key={c.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggleSelect(c.id)}
                    className="accent-green-600"
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{c.full_name}</p>
                    <p className="text-xs text-gray-500 font-mono">{c.wa_number}</p>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Members list */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <p className="text-sm font-medium text-gray-700 mb-2">Daftar Anggota</p>
          {loadingMembers ? (
            <p className="text-sm text-gray-400">Memuat...</p>
          ) : members.length === 0 ? (
            <p className="text-sm text-gray-400">Belum ada anggota.</p>
          ) : (
            <div className="space-y-1">
              {members.map((m) => (
                <div key={m.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{m.full_name}</p>
                    <p className="text-xs text-gray-500 font-mono">{m.wa_number}</p>
                  </div>
                  <button
                    onClick={() => handleRemoveMember(m.id)}
                    className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 transition-colors"
                  >
                    Hapus
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t">
          <button onClick={onClose} className="w-full py-2 text-sm border rounded-lg hover:bg-gray-50 transition-colors">Tutup</button>
        </div>
      </div>
    </div>
  );
}
