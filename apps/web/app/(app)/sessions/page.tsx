import { createClient } from '@/src/lib/supabase/server';
import SessionsClient from './_components/SessionsClient';

export default async function SessionsPage() {
  const supabase = await createClient();
  const { data: sessions } = await supabase
    .from('wa_sessions')
    .select('id, session_key, phone_number, display_name, status, last_active_at, created_at')
    .order('created_at', { ascending: false });

  return <SessionsClient initialSessions={sessions ?? []} />;
}
