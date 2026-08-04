import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/src/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('users').select('role').eq('auth_user_id', user.id).single();
  if (profile?.role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json() as { email?: string; password?: string; full_name?: string };

  // Lookup auth_user_id from public.users
  const admin = createAdminClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['SUPABASE_SERVICE_ROLE_KEY']!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: targetUser } = await admin
    .from('users')
    .select('auth_user_id, email')
    .eq('id', id)
    .single();

  if (!targetUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // Update auth user (email and/or password)
  const authUpdate: Record<string, string> = {};
  if (body.email) authUpdate['email'] = body.email;
  if (body.password) authUpdate['password'] = body.password;

  if (Object.keys(authUpdate).length > 0) {
    const { error: authError } = await admin.auth.admin.updateUserById(
      targetUser.auth_user_id,
      authUpdate
    );
    if (authError) return NextResponse.json({ error: authError.message }, { status: 400 });
  }

  // Update public.users profile
  const profileUpdate: Record<string, string> = { updated_at: new Date().toISOString() };
  if (body.email) profileUpdate['email'] = body.email;
  if (body.full_name) profileUpdate['full_name'] = body.full_name;

  const { data: updated, error: updateError } = await admin
    .from('users')
    .update(profileUpdate)
    .eq('id', id)
    .select()
    .single();

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  return NextResponse.json(updated);
}
