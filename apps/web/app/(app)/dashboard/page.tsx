import { createClient } from '@/src/lib/supabase/server';

async function getDashboardStats() {
  const supabase = await createClient();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString();

  const [contactsRes, sentRes, failedRes, activeBroadcastsRes, sessionsRes, trendRes] =
    await Promise.all([
      supabase.from('contacts').select('id', { count: 'exact', head: true }),
      supabase
        .from('message_logs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'sent')
        .gte('created_at', todayIso),
      supabase
        .from('message_logs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'failed')
        .gte('created_at', todayIso),
      supabase
        .from('broadcast_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'running'),
      supabase.from('wa_sessions').select('id, session_key, phone_number, status, display_name'),
      supabase
        .from('message_logs')
        .select('created_at, status')
        .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
    ]);

  // Build 7-day trend
  const trendMap: Record<string, { sent: number; failed: number }> = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0]!;
    trendMap[key] = { sent: 0, failed: 0 };
  }
  for (const log of trendRes.data ?? []) {
    const key = log.created_at.split('T')[0]!;
    if (trendMap[key]) {
      if (log.status === 'sent') trendMap[key]!.sent++;
      if (log.status === 'failed') trendMap[key]!.failed++;
    }
  }
  const trend = Object.entries(trendMap).map(([date, counts]) => ({ date, ...counts }));

  return {
    totalContacts: contactsRes.count ?? 0,
    sentToday: sentRes.count ?? 0,
    failedToday: failedRes.count ?? 0,
    activeBroadcasts: activeBroadcastsRes.count ?? 0,
    sessions: sessionsRes.data ?? [],
    trend,
  };
}

export default async function DashboardPage() {
  const stats = await getDashboardStats();
  return <DashboardView stats={stats} />;
}

// ─── Inline Client View ───────────────────────────────────────────────────────
import DashboardClient from './_components/DashboardClient';

function DashboardView({ stats }: { stats: Awaited<ReturnType<typeof getDashboardStats>> }) {
  return <DashboardClient stats={stats} />;
}
