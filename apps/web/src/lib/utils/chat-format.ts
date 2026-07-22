/**
 * Utility functions for formatting chat messages in the WhatsApp Chat Inbox.
 * Requirements: 4.2, 4.3, 5.3, 7.2
 */

const DAYS_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

/**
 * Formats a message timestamp for display in chat bubbles.
 * - Today: "HH:mm" (e.g. "13:45")
 * - Other days: "Hari HH:mm" (e.g. "Senin 13:45")
 *
 * Requirement: 5.3
 */
export function formatMessageTime(date: string): string {
  const messageDate = new Date(date);
  const now = new Date();

  const isToday =
    messageDate.getFullYear() === now.getFullYear() &&
    messageDate.getMonth() === now.getMonth() &&
    messageDate.getDate() === now.getDate();

  const hours = String(messageDate.getHours()).padStart(2, '0');
  const minutes = String(messageDate.getMinutes()).padStart(2, '0');
  const timeStr = `${hours}:${minutes}`;

  if (isToday) {
    return timeStr;
  }

  const dayName = DAYS_ID[messageDate.getDay()] ?? '';
  return `${dayName} ${timeStr}`;
}

/**
 * Truncates a message preview to a maximum of 40 characters.
 * For image messages, returns "Gambar" regardless of body content.
 *
 * Requirements: 4.2, 4.3
 */
export function truncatePreview(body: string | null, type: 'text' | 'image'): string {
  if (type === 'image') return 'Gambar';
  if (!body) return '';
  if (body.length <= 40) return body;
  return body.slice(0, 40);
}

/**
 * Validates an image file for type (JPEG or PNG) and size (max 5 MB).
 * Returns { valid: true } or { valid: false, error: string }.
 *
 * Requirement: 7.2
 */
export function validateImageFile(file: File): { valid: boolean; error?: string } {
  const ALLOWED_TYPES = ['image/jpeg', 'image/png'];
  const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

  if (!ALLOWED_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: `Tipe file tidak didukung: ${file.type}. Hanya JPEG dan PNG yang diizinkan.`,
    };
  }

  if (file.size > MAX_SIZE_BYTES) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `Ukuran file (${sizeMb} MB) melebihi batas maksimum 5 MB.`,
    };
  }

  return { valid: true };
}
