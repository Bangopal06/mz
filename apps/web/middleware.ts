import { type NextRequest } from 'next/server';
import { updateSession } from '@/src/lib/supabase/middleware';

/**
 * Next.js Middleware entry point.
 * Delegates to updateSession() which handles:
 *  - Silent JWT refresh via @supabase/ssr
 *  - Redirect unauthenticated users to /login
 *  - Redirect authenticated users away from /login to /dashboard
 *  - Passes /api/* through without session enforcement
 */
export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Run middleware on all routes except:
     * - _next/static  (static files)
     * - _next/image   (Next.js image optimisation)
     * - favicon.ico
     * - Public static assets (svg, png, jpg, jpeg, gif, webp)
     *
     * Note: /api/* routes are excluded from auth enforcement inside
     * updateSession(), not here — so they still pass through middleware
     * and get cookie refresh applied.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
