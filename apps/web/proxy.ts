import { type NextRequest } from 'next/server';
import { updateSession } from '@/src/lib/supabase/middleware';

/**
 * Next.js Proxy entry point (formerly middleware).
 * Delegates to updateSession() which handles:
 *  - Silent JWT refresh via @supabase/ssr
 *  - Redirect unauthenticated users to /login
 *  - Redirect authenticated users away from /login to /dashboard
 *  - Passes /api/* through without session enforcement
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
