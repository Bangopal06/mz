import { createClient } from '@/src/lib/supabase/server';
import BroadcastWizard from './_components/BroadcastWizard';

export default async function NewBroadcastPage() {
  const supabase = await createClient();

  const [{ data: groups }, { data: templates }, { data: sessions }] = await Promise.all([
    supabase.from('contact_groups').select('id, name').order('name'),
    supabase.from('message_templates').select('id, title, body').order('title'),
    supabase.from('wa_sessions').select('id, session_key, phone_number, display_name, status').eq('status', 'connected'),
  ]);

  return (
    <BroadcastWizard
      groups={groups ?? []}
      templates={templates ?? []}
      sessions={sessions ?? []}
    />
  );
}
