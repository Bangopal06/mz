import { createClient } from '@/src/lib/supabase/server';
import { notFound } from 'next/navigation';
import BroadcastDetail from './_components/BroadcastDetail';

export default async function BroadcastDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: broadcast } = await supabase
    .from('broadcast_jobs')
    .select('*')
    .eq('id', id)
    .single();

  if (!broadcast) notFound();

  const { data: logs } = await supabase
    .from('message_logs')
    .select('id, wa_number, status, error_message, sent_at')
    .eq('broadcast_id', id)
    .order('created_at')
    .limit(200);

  return <BroadcastDetail broadcast={broadcast} initialLogs={logs ?? []} />;
}
