import { createClient } from '@/src/lib/supabase/server';
import LogsClient from './_components/LogsClient';

export default async function LogsPage() {
  const supabase = await createClient();

  // Fetch up to 1000 recent logs; client handles filtering and pagination
  const { data: logs } = await supabase
    .from('activity_logs')
    .select('id, action, entity_type, entity_id, detail, ip_address, created_at, user_id, users(full_name, email)')
    .order('created_at', { ascending: false })
    .limit(1000);

  return <LogsClient initialLogs={(logs as ActivityLogWithUser[]) ?? []} />;
}

export interface ActivityLogWithUser {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  detail: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
  users: { full_name: string; email: string } | null;
}
