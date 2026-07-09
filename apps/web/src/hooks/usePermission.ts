'use client';
import { useAuth } from './useAuth';

const PERMISSIONS: Record<string, string[]> = {
  'contacts:write': ['owner', 'admin'],
  'contacts:read': ['owner', 'admin', 'staff', 'operator'],
  'groups:write': ['owner', 'admin'],
  'broadcasts:write': ['owner', 'admin', 'staff'],
  'broadcasts:read': ['owner', 'admin', 'staff'],
  'templates:write': ['owner', 'admin'],
  'sessions:manage': ['owner'],
  'users:manage': ['owner'],
  'logs:read': ['owner', 'admin'],
  'auto-reply:write': ['owner', 'admin'],
};

export function usePermission(permission: string): boolean {
  const { user } = useAuth();
  if (!user) return false;
  return PERMISSIONS[permission]?.includes(user.role) ?? false;
}
