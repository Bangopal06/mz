import { createClient } from '@/src/lib/supabase/server';
import BroadcastsClient from './_components/BroadcastsClient';

export default async function BroadcastsPage() {
  const supabase = await createClient();
  const { data: broadcasts } = await supabase
    .from('broadcast_jobs')
    .select('id, title, status, recipient_type, total_recipients, sent_count, failed_count, created_at, scheduled_at, completed_at')
    .order('created_at', { ascending: false })
    .limit(500);

  return <BroadcastsClient initialBroadcasts={broadcasts ?? []} />;
}
