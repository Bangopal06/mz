import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './database.types';

/**
 * Creates a Supabase client for use in browser (Client Components).
 * Uses anon key — access is controlled by Row Level Security (RLS).
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']!
  );
}
