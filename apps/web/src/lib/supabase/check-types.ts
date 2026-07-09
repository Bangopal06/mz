// Diagnostic file - verify Database type satisfies GenericSchema
// Run: npx tsc --noEmit --diagnostics
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

// Check if Database['public'] extends GenericSchema
type PublicSchema = Database['public'];

// If this compiles without error, the Database type is correct
const _typeCheck: SupabaseClient<Database> = undefined as unknown as SupabaseClient<Database>;

// Try accessing a table
type UsersRow = Database['public']['Tables']['users']['Row'];
const _user: UsersRow = undefined as unknown as UsersRow;

export {};
