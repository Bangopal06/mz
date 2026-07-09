'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/src/lib/supabase/client';
import { UserTable, type UserRow, type UserRole } from './UserTable';
import { CreateUserModal, type CreateUserFormData } from './CreateUserModal';

interface UsersClientProps {
  initialUsers: UserRow[];
  currentUserId: string;
}

/**
 * Guard: ensure at least one active owner remains after the operation.
 * Returns an error string if the guard fails, otherwise null.
 */
function checkOwnerGuard(
  users: UserRow[],
  targetUserId: string,
  operation: 'deactivate' | 'delete' | 'change-role',
  newRole?: UserRole
): string | null {
  const target = users.find((u) => u.id === targetUserId);
  if (!target) return null;

  const activeOwners = users.filter((u) => u.role === 'owner' && u.is_active);

  if (operation === 'deactivate' && target.role === 'owner' && target.is_active) {
    if (activeOwners.length <= 1) {
      return 'Tidak dapat menonaktifkan pengguna ini. Minimal satu Owner aktif harus tersedia dalam sistem.';
    }
  }

  if (operation === 'delete' && target.role === 'owner' && target.is_active) {
    if (activeOwners.length <= 1) {
      return 'Tidak dapat menghapus pengguna ini. Minimal satu Owner aktif harus tersedia dalam sistem.';
    }
  }

  if (operation === 'change-role' && target.role === 'owner' && target.is_active && newRole !== 'owner') {
    if (activeOwners.length <= 1) {
      return `Tidak dapat mengubah role pengguna ini. Minimal satu Owner aktif harus tersedia dalam sistem.`;
    }
  }

  return null;
}

export function UsersClient({ initialUsers, currentUserId }: UsersClientProps) {
  const router = useRouter();
  const supabase = createClient();

  const [users, setUsers] = useState<UserRow[]>(initialUsers);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [errorDialog, setErrorDialog] = useState<string | null>(null);

  const refreshUsers = useCallback(() => {
    router.refresh();
  }, [router]);

  async function handleRoleChange(userId: string, newRole: UserRole) {
    const guardError = checkOwnerGuard(users, userId, 'change-role', newRole);
    if (guardError) {
      setErrorDialog(guardError);
      return;
    }

    const { error } = await supabase
      .from('users')
      .update({ role: newRole, updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (error) {
      setErrorDialog(`Gagal mengubah role: ${error.message}`);
      return;
    }

    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
    );
  }

  async function handleToggleActive(userId: string, currentlyActive: boolean) {
    if (currentlyActive) {
      // Deactivating — check owner guard
      const guardError = checkOwnerGuard(users, userId, 'deactivate');
      if (guardError) {
        setErrorDialog(guardError);
        return;
      }
    }

    const newStatus = !currentlyActive;
    const { error } = await supabase
      .from('users')
      .update({ is_active: newStatus, updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (error) {
      setErrorDialog(`Gagal mengubah status: ${error.message}`);
      return;
    }

    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, is_active: newStatus } : u))
    );
    refreshUsers();
  }

  async function handleDelete(userId: string) {
    const guardError = checkOwnerGuard(users, userId, 'delete');
    if (guardError) {
      setErrorDialog(guardError);
      return;
    }

    const { error } = await supabase.from('users').delete().eq('id', userId);

    if (error) {
      setErrorDialog(`Gagal menghapus pengguna: ${error.message}`);
      return;
    }

    setUsers((prev) => prev.filter((u) => u.id !== userId));
  }

  async function handleCreateUser(data: CreateUserFormData) {
    const response = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(errData.error ?? `Gagal membuat pengguna (${response.status})`);
    }

    const newUser = await response.json() as UserRow;
    setUsers((prev) => [...prev, newUser]);
  }

  return (
    <div className="space-y-8">
      {/* Error Dialog */}
      {errorDialog && (
        <div
          role="alertdialog"
          aria-labelledby="error-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h3 id="error-dialog-title" className="text-base font-semibold text-red-700 mb-2">
              Operasi Ditolak
            </h3>
            <p className="text-sm text-gray-700 mb-5">{errorDialog}</p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setErrorDialog(null)}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 transition-colors"
              >
                Mengerti
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Manajemen Pengguna</h1>
          <p className="mt-1 text-sm text-gray-500">
            {users.length} pengguna terdaftar
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-1 transition-colors"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
          </svg>
          Tambah User
        </button>
      </div>

      {/* Users Table */}
      <UserTable
        users={users}
        currentUserId={currentUserId}
        onRoleChange={handleRoleChange}
        onToggleActive={handleToggleActive}
        onDelete={handleDelete}
      />

      {/* Create User Modal */}
      <CreateUserModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleCreateUser}
      />

      {/* Permission Matrix */}
      <div className="mt-10">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Permission Matrix</h2>
        <p className="text-sm text-gray-500 mb-4">
          Tabel di bawah menunjukkan hak akses setiap role terhadap fitur-fitur sistem.
        </p>
        <PermissionMatrix />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Permission Matrix (hardcoded, read-only)
// ---------------------------------------------------------------------------

const PERMISSIONS = [
  { feature: 'Dashboard', owner: true, admin: true, staff: true, operator: true },
  { feature: 'Manajemen Kontak (CRUD)', owner: true, admin: true, staff: false, operator: false },
  { feature: 'Lihat Kontak', owner: true, admin: true, staff: true, operator: true },
  { feature: 'Manajemen Grup Kontak', owner: true, admin: true, staff: false, operator: false },
  { feature: 'Import Kontak', owner: true, admin: true, staff: false, operator: false },
  { feature: 'Template Pesan (CRUD)', owner: true, admin: true, staff: false, operator: false },
  { feature: 'Buat & Kirim Broadcast', owner: true, admin: true, staff: true, operator: false },
  { feature: 'Lihat Riwayat Broadcast', owner: true, admin: true, staff: true, operator: false },
  { feature: 'Manajemen Sesi WhatsApp', owner: true, admin: true, staff: false, operator: false },
  { feature: 'Auto Reply (CRUD)', owner: true, admin: true, staff: false, operator: false },
  { feature: 'Log Aktivitas', owner: true, admin: true, staff: false, operator: false },
  { feature: 'Manajemen Pengguna', owner: true, admin: false, staff: false, operator: false },
  { feature: 'Ubah Role Pengguna', owner: true, admin: false, staff: false, operator: false },
];

function Check({ allowed }: { allowed: boolean }) {
  return allowed ? (
    <span className="flex justify-center">
      <svg className="h-4 w-4 text-green-600" viewBox="0 0 20 20" fill="currentColor" aria-label="Diizinkan">
        <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
      </svg>
    </span>
  ) : (
    <span className="flex justify-center">
      <svg className="h-4 w-4 text-gray-300" viewBox="0 0 20 20" fill="currentColor" aria-label="Tidak diizinkan">
        <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
      </svg>
    </span>
  );
}

function PermissionMatrix() {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide w-1/2">
              Fitur
            </th>
            {(['Owner', 'Admin', 'Staff', 'Operator'] as const).map((role) => (
              <th
                key={role}
                className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wide"
              >
                {role}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-100">
          {PERMISSIONS.map((row) => (
            <tr key={row.feature} className="hover:bg-gray-50 transition-colors">
              <td className="px-4 py-3 text-sm text-gray-700">{row.feature}</td>
              <td className="px-4 py-3"><Check allowed={row.owner} /></td>
              <td className="px-4 py-3"><Check allowed={row.admin} /></td>
              <td className="px-4 py-3"><Check allowed={row.staff} /></td>
              <td className="px-4 py-3"><Check allowed={row.operator} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
