import { createClient } from '@/src/lib/supabase/server';
import GroupsClient from './_components/GroupsClient';

export default async function GroupsPage() {
  const supabase = await createClient();

  const { data: groups } = await supabase
    .from('contact_groups')
    .select('id, name, description, created_at')
    .order('name');

  // Get member counts
  const groupsWithCount = await Promise.all(
    (groups ?? []).map(async (g) => {
      const { count } = await supabase
        .from('contact_group_members')
        .select('contact_id', { count: 'exact', head: true })
        .eq('group_id', g.id);
      return { ...g, member_count: count ?? 0 };
    })
  );

  return <GroupsClient initialGroups={groupsWithCount} />;
}
