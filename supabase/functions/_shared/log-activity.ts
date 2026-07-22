/**
 * Shared helper: logActivity
 * Records important system actions to the activity_logs table.
 *
 * Usage (from any Edge Function):
 *   import { logActivity } from '../_shared/log-activity.ts'
 *   await logActivity(supabase, { user_id, action: 'broadcast.create', entity_type: 'broadcast', entity_id: job.id, detail: {...} })
 *
 * Actions tracked:
 *   login, login.failed, broadcast.create, broadcast.cancel, broadcast.resume,
 *   contact.delete, user.role_change, error.send, auto_reply.sent, session.expired
 *
 * Requirements: 10.1, 10.4, 12.7
 */

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

export interface LogActivityParams {
  /** public.users.id — nullable for system/anonymous actions */
  user_id?: string | null
  /** Action identifier, e.g. 'broadcast.create', 'contact.delete' */
  action: string
  /** Type of entity affected, e.g. 'broadcast', 'contact', 'user' */
  entity_type?: string | null
  /** ID of the affected entity */
  entity_id?: string | null
  /** Extra JSON payload with action-specific context */
  detail?: Record<string, unknown> | null
  /** Client IP address — pass from request headers when available */
  ip_address?: string | null
}

/**
 * Insert a row into activity_logs.
 * Errors are caught and logged to console — never throws so callers don't fail.
 */
export async function logActivity(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  params: LogActivityParams
): Promise<void> {
  try {
    const { error } = await supabase.from('activity_logs').insert({
      user_id: params.user_id ?? null,
      action: params.action,
      entity_type: params.entity_type ?? null,
      entity_id: params.entity_id ?? null,
      detail: params.detail ?? null,
      ip_address: params.ip_address ?? null,
    })
    if (error) {
      console.error('[logActivity] Failed to insert log:', error.message)
    }
  } catch (err) {
    console.error('[logActivity] Unexpected error:', err)
  }
}

/** Extract client IP from common forwarded headers */
export function getClientIp(req: Request): string | null {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    null
  )
}
