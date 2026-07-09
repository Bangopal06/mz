'use client';

import { useState } from 'react';

export type UserRole = 'owner' | 'admin' | 'staff' | 'operator';

export interface UserRow {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
}

interface UserTableProps {
  users: UserRow[];
  currentUserId: string;
  onRoleChange: (userId: string, newRole: UserRole) => Promise<void>;
  onToggleActive: (userId: string, currentlyActive: boolean) => Promise<void>;
  onDelete: (userId: string) => Promise<void>;
}

const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  staff: 'Staff',
  operator: 'Operator',
};

const ROLE_BADGE_COLORS: Record<UserRole, string> = {
  owner: 'bg-purple-100 text-purple-800 ring-purple-200',
  admin: 'bg-blue-100 text-blue-800 ring-blue-200',
  staff: 'bg-green-100 text-green-800 ring-green-200',
  operator: 'bg-gray-100 text-gray-700 ring-gray-200',
};

const ALL_ROLES: UserRole[] = ['owner', 'admin', 'staff', 'operator'];

export function UserTable({
  users,
  currentUserId,
  onRoleChange,
  onToggleActive,
  onDelete,
}: UserTableProps) {
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  async function handleRoleChange(userId: string, newRole: UserRole) {
    setPendingAction(`role-${userId}`);
    try {
      await onRoleChange(userId, newRole);
    } finally {
      setPendingAction(null);
    }
  }

  async function handleToggleActive(userId: string, currentlyActive: boolean) {
    setPendingAction(`toggle-${userId}`);
    try {
      await onToggleActive(userId, currentlyActive);
    } finally {
      setPendingAction(null);
    }
  }

  async function handleDelete(userId: string, email: string) {
    const confirmed = window.confirm(
      `Apakah Anda yakin ingin menghapus akun "${email}"? Tindakan ini tidak dapat dibatalkan.`
    );
    if (!confirmed) return;
    setPendingAction(`delete-${userId}`);
    try {
      await onDelete(userId);
    } finally {
      setPendingAction(null);
    }
  }

  if (users.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        Belum ada pengguna terdaftar.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Pengguna
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Role
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Status
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Terdaftar
            </th>
            <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Aksi
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-100">
          {users.map((user) => {
            const isSelf = user.id === currentUserId;
            const isRolePending = pendingAction === `role-${user.id}`;
            const isTogglePending = pendingAction === `toggle-${user.id}`;
            const isDeletePending = pendingAction === `delete-${user.id}`;
            const isAnyPending = isRolePending || isTogglePending || isDeletePending;

            return (
              <tr
                key={user.id}
                className={`transition-colors ${isAnyPending ? 'opacity-60' : 'hover:bg-gray-50'}`}
              >
                {/* Pengguna */}
                <td className="px-4 py-3">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-gray-900">
                      {user.full_name}
                      {isSelf && (
                        <span className="ml-2 text-xs text-gray-400">(Anda)</span>
                      )}
                    </span>
                    <span className="text-xs text-gray-500">{user.email}</span>
                  </div>
                </td>

                {/* Role */}
                <td className="px-4 py-3">
                  <select
                    value={user.role}
                    disabled={isSelf || isAnyPending}
                    onChange={(e) => handleRoleChange(user.id, e.target.value as UserRole)}
                    aria-label={`Ubah role ${user.full_name}`}
                    className={`text-xs font-medium rounded-full px-3 py-1 ring-1 ring-inset cursor-pointer focus:outline-none focus:ring-2 focus:ring-green-500 disabled:cursor-not-allowed ${ROLE_BADGE_COLORS[user.role]}`}
                  >
                    {ALL_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                </td>

                {/* Status */}
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-0.5 ${
                      user.is_active
                        ? 'bg-green-50 text-green-700 ring-1 ring-green-200'
                        : 'bg-red-50 text-red-600 ring-1 ring-red-200'
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        user.is_active ? 'bg-green-500' : 'bg-red-400'
                      }`}
                      aria-hidden="true"
                    />
                    {user.is_active ? 'Aktif' : 'Nonaktif'}
                  </span>
                </td>

                {/* Terdaftar */}
                <td className="px-4 py-3 text-xs text-gray-500">
                  {new Date(user.created_at).toLocaleDateString('id-ID', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </td>

                {/* Aksi */}
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    {/* Toggle Active / Inactive */}
                    <button
                      type="button"
                      disabled={isSelf || isAnyPending}
                      onClick={() => handleToggleActive(user.id, user.is_active)}
                      className="text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-green-500 border-gray-300 text-gray-700 hover:bg-gray-50"
                    >
                      {isTogglePending ? '…' : user.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                    </button>

                    {/* Delete */}
                    <button
                      type="button"
                      disabled={isSelf || isAnyPending}
                      onClick={() => handleDelete(user.id, user.email)}
                      className="text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-red-400 border-red-200 text-red-600 hover:bg-red-50"
                    >
                      {isDeletePending ? '…' : 'Hapus'}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
