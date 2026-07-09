import { createClient } from '@/src/lib/supabase/server';
import TemplatesClient from './_components/TemplatesClient';

export default async function TemplatesPage() {
  const supabase = await createClient();
  const { data: templates } = await supabase
    .from('message_templates')
    .select('id, title, body, created_at')
    .order('created_at', { ascending: false });

  return <TemplatesClient initialTemplates={templates ?? []} />;
}
