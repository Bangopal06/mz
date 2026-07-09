export interface Contact {
  id: string;
  full_name: string;
  wa_number: string;
  category: string | null;
  status: 'active' | 'inactive';
  notes: string | null;
  joined_at: string;
  created_at: string;
}

export interface ContactFilter {
  search?: string;
  status?: 'active' | 'inactive';
  category?: string;
  group_id?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function validateWaNumber(phone: string): boolean {
  const cleaned = phone.replace(/\D/g, '');
  return /^62\d{8,13}$/.test(cleaned);
}

export function sanitizeWaNumber(phone: string): string {
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) cleaned = '62' + cleaned.slice(1);
  if (!cleaned.startsWith('62')) cleaned = '62' + cleaned;
  return cleaned;
}
