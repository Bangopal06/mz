import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

/**
 * Creates a Supabase client using the service role key.
 * For use ONLY in server-side code (API routes, server actions).
 * Has full bypass of RLS — use carefully.
 */
export function createServiceClient() {
  const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL']!;
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY']!;

  return createSupabaseClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
