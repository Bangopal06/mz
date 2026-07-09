import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from './database.types';

/**
 * Routes that do not require authentication.
 * Requests to these paths are allowed through without a valid session.
 */
const PUBLIC_PATHS: string[] = ['/login'];

/**
 * Returns true if the given pathname is a public (unauthenticated) route.
 * API routes (/api/*) are also excluded from session-based auth checks
 * because they carry their own authorization headers.
 */
function isPublicPath(pathname: string): boolean {
  if (pathname.startsWith('/api/')) return true;
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/')
  );
}

/**
 * Creates a Supabase client for use in Next.js middleware.
 * Handles silent token refresh by propagating updated cookies on both the
 * request and response.
 *
 * Authentication flow:
 *  - If the user has no valid session and tries to access a protected route
 *    → redirect to /login
 *  - If the user already has a valid session and tries to access /login
 *    → redirect to /dashboard
 *  - /api/* routes and /login are always allowed through for further handling.
 */
export async function updateSession(request: NextRequest) {
  // We need a mutable response so that refreshed cookies can be forwarded.
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          // Forward updated cookies onto the request (needed by downstream
          // server components that read the cookie store in the same request).
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          // Re-create the response so cookies are also forwarded to the browser.
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: do not add logic between createServerClient and getUser.
  // getUser() validates the JWT and silently refreshes it when needed.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Allow API routes and public paths through regardless of session state.
  if (isPublicPath(pathname)) {
    // If authenticated user visits /login → redirect to /dashboard
    if (user && pathname.startsWith('/login')) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = '/dashboard';
      return NextResponse.redirect(redirectUrl);
    }
    return supabaseResponse;
  }

  // Protected route: no session → redirect to /login
  if (!user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/login';
    // Preserve the original URL so we can redirect back after login (optional)
    redirectUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // Authenticated — pass through with refreshed cookies.
  return supabaseResponse;
}
