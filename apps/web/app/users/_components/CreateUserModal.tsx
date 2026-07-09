'use client';

import { useState, useRef, useEffect } from 'react';
import type { UserRole } from './UserTable';

interface CreateUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateUserFormData) => Promise<void>;
}

export interface CreateUserFormData {
  email: string;
  full_name: string;
  role: UserRole;
  password: string;
}

interface FieldErrors {
  email?: string;
  full_name?: string;
  password?: string;
}

const ROLE_OPTIONS: { value: UserRole; label: string; description: string }[] = [
  { value: 'owner', label: 'Owner', description: 'Akses penuh ke seluruh fitur termasuk manajemen user' },
  { value: 'admin', label: 'Admin', description: 'Akses operasional penuh kecuali manajemen user lain' },
  { value: 'staff', label: 'Staff', description: 'Akses untuk membuat dan mengirim broadcast' },
  { value: 'operator', label: 'Operator', description: 'Akses hanya untuk melihat data kontak' },
];

export function CreateUserModal({ isOpen, onClose, onSubmit }: CreateUserModalProps) {
  const [values, setValues] = useState<CreateUserFormData>({
    email: '',
    full_name: '',
    role: 'staff',
    password: '',
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const firstInputRef = useRef<HTMLInputElement>(null);

  // Focus first input when modal opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => firstInputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Reset state when closed
  useEffect(() => {
    if (!isOpen) {
      setValues({ email: '', full_name: '', role: 'staff', password: '' });
      setFieldErrors({});
      setServerError(null);
      setLoading(false);
    }
  }, [isOpen]);

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (!values.full_name.trim()) errors.full_name = 'Nama lengkap wajib diisi.';
    if (!values.email.trim()) {
      errors.email = 'Email wajib diisi.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
      errors.email = 'Format email tidak valid.';
    }
    if (!values.password) {
      errors.password = 'Password wajib diisi.';
    } else if (values.password.length < 8) {
      errors.password = 'Password minimal 8 karakter.';
    }
    return errors;
  }

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) {
    const { name, value } = e.target;
    setValues((prev) => ({ ...prev, [name]: value }));
    if (fieldErrors[name as keyof FieldErrors]) {
      setFieldErrors((prev) => ({ ...prev, [name]: undefined }));
    }
    setServerError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setLoading(true);
    setServerError(null);
    try {
      await onSubmit(values);
      onClose();
    } catch (err) {
      setServerError(
        err instanceof Error ? err.message : 'Terjadi kesalahan. Silakan coba lagi.'
      );
    } finally {
      setLoading(false);
    }
  }

  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100">
          <h2 id="modal-title" className="text-lg font-semibold text-gray-900">
            Tambah Pengguna Baru
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup modal"
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} noValidate className="px-6 py-5 space-y-5">
          {serverError && (
            <div role="alert" className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              {serverError}
            </div>
          )}

          {/* Nama Lengkap */}
          <div>
            <label htmlFor="full_name" className="block text-sm font-medium text-gray-700 mb-1">
              Nama Lengkap
            </label>
            <input
              ref={firstInputRef}
              id="full_name"
              name="full_name"
              type="text"
              value={values.full_name}
              onChange={handleChange}
              disabled={loading}
              aria-describedby={fieldErrors.full_name ? 'full_name-error' : undefined}
              aria-invalid={!!fieldErrors.full_name}
              className={`block w-full rounded-lg border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500 disabled:bg-gray-100 disabled:cursor-not-allowed ${
                fieldErrors.full_name ? 'border-red-400' : 'border-gray-300'
              }`}
              placeholder="Nama lengkap pengguna"
            />
            {fieldErrors.full_name && (
              <p id="full_name-error" className="mt-1 text-xs text-red-600">
                {fieldErrors.full_name}
              </p>
            )}
          </div>

          {/* Email */}
          <div>
            <label htmlFor="create-email" className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              id="create-email"
              name="email"
              type="email"
              value={values.email}
              onChange={handleChange}
              disabled={loading}
              aria-describedby={fieldErrors.email ? 'create-email-error' : undefined}
              aria-invalid={!!fieldErrors.email}
              className={`block w-full rounded-lg border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500 disabled:bg-gray-100 disabled:cursor-not-allowed ${
                fieldErrors.email ? 'border-red-400' : 'border-gray-300'
              }`}
              placeholder="email@contoh.com"
            />
            {fieldErrors.email && (
              <p id="create-email-error" className="mt-1 text-xs text-red-600">
                {fieldErrors.email}
              </p>
            )}
          </div>

          {/* Password */}
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              value={values.password}
              onChange={handleChange}
              disabled={loading}
              aria-invalid={!!fieldErrors.password}
              className={`block w-full rounded-lg border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500 disabled:bg-gray-100 disabled:cursor-not-allowed ${
                fieldErrors.password ? 'border-red-400' : 'border-gray-300'
              }`}
              placeholder="Minimal 8 karakter"
            />
            {fieldErrors.password && (
              <p className="mt-1 text-xs text-red-600">{fieldErrors.password}</p>
            )}
          </div>

          {/* Role */}
          <div>
            <label htmlFor="role" className="block text-sm font-medium text-gray-700 mb-1">
              Role
            </label>            <select
              id="role"
              name="role"
              value={values.role}
              onChange={handleChange}
              disabled={loading}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
            >
              {ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label} — {opt.description}
                </option>
              ))}
            </select>
          </div>

          <p className="text-xs text-gray-500">
            Kredensial login awal akan dikirimkan ke alamat email yang didaftarkan.
          </p>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Menyimpan…
                </>
              ) : (
                'Tambah Pengguna'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
