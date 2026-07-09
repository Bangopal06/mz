import { createClient } from '@/src/lib/supabase/server';
import ContactsClient from './_components/ContactsClient';

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string; status?: string; group_id?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? '1', 10));
  const pageSize = 50;
  const supabase = await createClient();

  // Fetch groups for filter dropdown
  const { data: groups } = await supabase
    .from('contact_groups')
    .select('id, name')
    .order('name');

  return (
    <ContactsClient
      initialPage={page}
      pageSize={pageSize}
      groups={groups ?? []}
      initialSearch={params.search ?? ''}
      initialStatus={params.status ?? ''}
      initialGroupId={params.group_id ?? ''}
    />
  );
}
