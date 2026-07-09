import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/src/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

export async function POST(request: NextRequest) {
  // Verify caller is authenticated and is owner
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('users').select('role').eq('auth_user_id', user.id).single();
  if (profile?.role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json() as { email: string; full_name: string; role: string; password: string };
  const { email, full_name, role, password } = body;

  if (!email || !full_name || !role || !password) {
    return NextResponse.json({ error: 'email, full_name, role, password required' }, { status: 400 });
  }

  // Use service role to create auth user
  const admin = createAdminClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['SUPABASE_SERVICE_ROLE_KEY']!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name, role },
  });

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 400 });
  }

  // Insert into public.users (trigger should handle this, but do it explicitly too)
  const { data: newUser, error: insertError } = await admin
    .from('users')
    .upsert({
      auth_user_id: authData.user.id,
      email,
      full_name,
      role,
      is_active: true,
    }, { onConflict: 'auth_user_id' })
    .select()
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json(newUser, { status: 201 });
}
