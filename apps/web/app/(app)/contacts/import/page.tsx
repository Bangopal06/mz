import { createClient } from '@/src/lib/supabase/server';
import ImportClient from './_components/ImportClient';

export default async function ImportPage() {
  const supabase = await createClient();
  const { data: groups } = await supabase.from('contact_groups').select('id, name').order('name');
  return <ImportClient groups={groups ?? []} />;
}
