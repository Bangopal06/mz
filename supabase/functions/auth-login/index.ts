/**
 * Edge Function: auth-login
 *
 * Handles user authentication with rate limiting and account lockout.
 *
 * POST body: { email: string, password: string }
 *
 * Responses:
 *  200 — Login berhasil, returns { access_token, refresh_token, user }
 *  400 — Bad request (missing/invalid fields)
 *  401 — Kredensial salah
 *  423 — Akun terkunci (>= 5 gagal dalam 15 menit terakhir)
 *  500 — Internal server error
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'

/** Window in minutes for counting failed attempts. */
const LOCKOUT_WINDOW_MINUTES = 15;
/** Maximum allowed failures before lockout. */
const MAX_FAILURES = 5;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // --- Parse body ---
  let email: string;
  let password: string;

  try {
    const body = await req.json() as { email?: unknown; password?: unknown };
    email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    password = typeof body.password === 'string' ? body.password : '';
  } catch {
    return json({ error: 'Request body tidak valid.' }, 400);
  }

  if (!email || !password) {
    return json({ error: 'Email dan password wajib diisi.' }, 400);
  }

  // Basic email format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'Format email tidak valid.' }, 400);
  }

  if (password.length < 8) {
    return json({ error: 'Password minimal 8 karakter.' }, 400);
  }

  // --- Create admin Supabase client (bypasses RLS) ---
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

  // --- Check failed login attempts in the last 15 minutes ---
  const windowStart = new Date(Date.now() - LOCKOUT_WINDOW_MINUTES * 60 * 1000).toISOString();

  const { count: failureCount, error: countError } = await supabase
    .from('failed_login_attempts')
    .select('*', { count: 'exact', head: true })
    .eq('email', email)
    .gte('attempt_at', windowStart);

  if (countError) {
    console.error('Failed to query failed_login_attempts:', countError);
    return json({ error: 'Terjadi kesalahan server. Silakan coba lagi.' }, 500);
  }

  if ((failureCount ?? 0) >= MAX_FAILURES) {
    // Log this locked attempt in activity_logs
    await supabase.from('activity_logs').insert({
      action: 'user.login_locked',
      entity_type: 'user',
      detail: { email, reason: 'account_locked', ip_address: clientIp },
      ip_address: clientIp,
    });

    return json(
      {
        error: `Akun Anda dikunci sementara karena terlalu banyak percobaan login yang gagal. Silakan coba lagi dalam ${LOCKOUT_WINDOW_MINUTES} menit.`,
        code: 'AUTH_LOCKED',
      },
      423
    );
  }

  // --- Attempt authentication via Supabase Auth Admin API ---
  // We use signInWithPassword on the regular client (anon key) so Supabase
  // handles bcrypt verification natively.
  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: authData, error: authError } = await anonClient.auth.signInWithPassword({
    email,
    password,
  });

  if (authError || !authData.session) {
    // Record failed attempt
    const { error: insertError } = await supabase.from('failed_login_attempts').insert({
      email,
      ip_address: clientIp,
    });

    if (insertError) {
      console.error('Failed to insert failed_login_attempts:', insertError);
    }

    // Log the failed attempt
    await supabase.from('activity_logs').insert({
      action: 'user.login_failed',
      entity_type: 'user',
      detail: { email, reason: authError?.message ?? 'invalid_credentials', ip_address: clientIp },
      ip_address: clientIp,
    });

    const remainingAttempts = MAX_FAILURES - ((failureCount ?? 0) + 1);
    const remainingMsg =
      remainingAttempts > 0
        ? ` Sisa percobaan: ${remainingAttempts}.`
        : ` Akun Anda akan dikunci pada percobaan berikutnya.`;

    return json(
      {
        error: `Email atau password salah.${remainingMsg}`,
        code: 'AUTH_INVALID_CREDENTIALS',
      },
      401
    );
  }

  // --- Login berhasil ---
  // Look up the user's profile in the public.users table
  const { data: userProfile } = await supabase
    .from('users')
    .select('id, email, full_name, role, is_active')
    .eq('auth_user_id', authData.user.id)
    .single();

  // Check if the user account is active
  if (userProfile && !userProfile.is_active) {
    // Sign out immediately
    await anonClient.auth.signOut();

    await supabase.from('activity_logs').insert({
      user_id: userProfile.id,
      action: 'user.login_denied_inactive',
      entity_type: 'user',
      entity_id: userProfile.id,
      detail: { email, reason: 'account_inactive' },
      ip_address: clientIp,
    });

    return json(
      {
        error: 'Akun Anda telah dinonaktifkan. Hubungi administrator.',
        code: 'AUTH_ACCOUNT_INACTIVE',
      },
      401
    );
  }

  // Log successful login
  await supabase.from('activity_logs').insert({
    user_id: userProfile?.id ?? null,
    action: 'user.login',
    entity_type: 'user',
    entity_id: userProfile?.id ?? null,
    detail: { email, ip_address: clientIp },
    ip_address: clientIp,
  });

  // Return session tokens
  return json({
    access_token: authData.session.access_token,
    refresh_token: authData.session.refresh_token,
    expires_in: authData.session.expires_in,
    token_type: authData.session.token_type,
    user: {
      id: authData.user.id,
      email: authData.user.email,
      role: userProfile?.role ?? null,
      full_name: userProfile?.full_name ?? null,
    },
  });
});
