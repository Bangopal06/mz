/**
 * Resolves {{variable}} placeholders in a template body.
 * Built-in: {{nama}} → contact.full_name, {{nomor}} → contact.wa_number
 * Custom fields: any other key from the contact object.
 * After resolution, any remaining {{...}} are stripped (blank string).
 */
export function resolveTemplate(
  body: string,
  contact: { full_name: string; wa_number: string; [key: string]: string | null | undefined }
): string {
  let result = body;

  // Built-in aliases first
  result = result.replace(/\{\{nama\}\}/gi,  contact.full_name  ?? '');
  result = result.replace(/\{\{nomor\}\}/gi, contact.wa_number  ?? '');

  // Remaining known contact fields
  for (const [key, value] of Object.entries(contact)) {
    result = result.replace(
      new RegExp(`\\{\\{${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}\\}`, 'gi'),
      value ?? ''
    );
  }

  // Strip any leftover unresolved placeholders
  result = result.replace(/\{\{[^}]*\}\}/g, '');

  return result;
}

/**
 * Checks if a template body is valid (non-empty after trimming).
 */
export function validateTemplateBody(body: string): boolean {
  return body.trim().length > 0;
}

/**
 * Returns a list of variable names found in the template body.
 */
export function extractTemplateVars(body: string): string[] {
  const matches = body.matchAll(/\{\{(\w+)\}\}/g);
  return [...new Set([...matches].map((m) => m[1]))];
}
