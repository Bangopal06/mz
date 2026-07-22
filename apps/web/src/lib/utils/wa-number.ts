/**
 * WhatsApp number validation and sanitization utilities.
 * Implements requirements 2.2 and will be extended in Task 5.1
 */

/**
 * Validates a WhatsApp number format.
 * Must start with '62', contain only digits, and be 10–15 digits long.
 *
 * @example
 * validateWaNumber('6281234567890') // true
 * validateWaNumber('081234567890')  // false
 * validateWaNumber('62812')         // false (too short)
 */
export function validateWaNumber(phone: string): boolean {
  return /^62\d{8,13}$/.test(phone);
}

/**
 * Sanitizes a phone number to the standard international WA format.
 * Strips non-digit characters and ensures it starts with '62'.
 *
 * @example
 * sanitizeWaNumber('+62 812-3456-7890') // '6281234567890'
 * sanitizeWaNumber('0812-3456-7890')    // '6281234567890'
 */
export function sanitizeWaNumber(phone: string): string {
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');

  // Replace leading 0 with 62
  if (digits.startsWith('0')) {
    return '62' + digits.slice(1);
  }

  // Replace leading +62 or 62 (already correct)
  if (digits.startsWith('62')) {
    return digits;
  }

  // Assume Indonesian number without country code
  return '62' + digits;
}

/**
 * Normalizes a WhatsApp number to the standard international format `62xxxxxxxxxx`.
 * Alias for sanitizeWaNumber — handles formats: `+62xxx`, `08xxx`, `62xxx`, `8xxx`.
 *
 * Requirement 1.5: contact_wa_number must always be stored in international format.
 *
 * @example
 * normalizeWaNumber('+628123456789')  // '628123456789'
 * normalizeWaNumber('08123456789')    // '628123456789'
 * normalizeWaNumber('628123456789')   // '628123456789'
 */
export function normalizeWaNumber(phone: string): string {
  return sanitizeWaNumber(phone);
}
