import { redirect } from 'next/navigation';
import { createClient } from '@/src/lib/supabase/server';
import { UsersClient } from '@/app/users/_components/UsersClient';
import type { UserRow } from '@/app/users/_components/UserTable';

export default async function UsersPage() {
  const supabase = await createClient();

  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) redirect('/login');

  const { data: currentUserProfile } = await supabase
    .from('users').select('id, role, is_active').eq('auth_user_id', authUser.id).single();

  if (!currentUserProfile) redirect('/login');

  if (currentUserProfile.role !== 'owner') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="bg-white rounded-2xl shadow-md p-8 max-w-md text-center">
          <h1 className="text-lg font-semibold text-gray-900 mb-2">Akses Ditolak</h1>
          <p className="text-sm text-gray-500">Halaman ini hanya untuk <strong>Owner</strong>.</p>
        </div>
      </div>
    );
  }

  const { data: usersData } = await supabase
    .from('users').select('id, email, full_name, role, is_active, created_at').order('created_at');

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <UsersClient initialUsers={(usersData ?? []) as UserRow[]} currentUserId={currentUserProfile.id} />
    </div>
  );
}
