import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// /explore (the Library) is deliberately open with no login or registration
// required — its own API dependencies (/api/chat's 'library' mode,
// /api/wiki-pathways) have to be reachable by an anonymous caller too.
// /api/chat still enforces its own per-mode role checks internally for
// every mode other than 'library' (see app/api/chat/route.ts) — making it
// reachable here doesn't weaken that, it just moves the "logged in?" check
// from this middleware into the route handler, which already treats itself
// as the real enforcement boundary regardless of this middleware.
//
// /strengthen and /contribute are also public paths now, but for a different
// reason: they're always visible in the sidebar, and each page handles its
// own tiered gating (see their own page.tsx — an AccessGateMessage for an
// anonymous or under-qualified visitor, the real workspace once approved).
// Letting the middleware redirect them away first would defeat that entirely.
const PUBLIC_PATHS = [
  '/login',
  '/explore',
  '/analyse',
  // Old route name (Navigate) — kept public purely so its redirect page
  // (app/navigate/page.tsx) can forward a stale link to /analyse without
  // hitting the login wall first.
  '/navigate',
  '/contribute',
  // Terms of Use / Privacy Notice — linked from the Sign up form, so they
  // must open for a visitor who doesn't have an account yet.
  '/terms',
  '/privacy',
  '/api/chat',
  '/api/wiki-pathways',
  // Published toolkit assets are public by the contributor's consent: the
  // metadata GET and the download route serve anonymous visitors. The
  // contributor-only POST routes under this prefix enforce their own auth
  // (lib/toolkit-assets-server.ts authorizePathwayContributor).
  '/api/toolkit-assets',
  // Called server-to-server by Supabase Auth (no session); authenticated by
  // its webhook signature inside the route instead.
  '/api/auth/send-email',
];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getUser() revalidates the token against Supabase rather than trusting
  // the local cookie, which matters here since this check gates the whole app.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublicPath = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!user && !isPublicPath) {
    if (pathname.startsWith('/api')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // The root path's own redirect logic ((app)/page.tsx) lives behind the
    // (app) layout's approval gate, which would otherwise show "Awaiting
    // approval" to a visitor who never even signed up. An anonymous "/" hit
    // goes straight to the Library instead of a login wall — /explore is the
    // one page that's supposed to need neither login nor registration.
    if (pathname === '/') {
      return NextResponse.redirect(new URL('/explore', request.url));
    }
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (user && pathname === '/login') {
    return NextResponse.redirect(new URL('/', request.url));
  }

  if (user) {
    // Forward the already-verified user's email via a request header so the
    // app layout doesn't need a second getUser() round trip on every
    // navigation — that duplicate Auth API call was the main source of the
    // slow "Home" click (proxy.ts already paid this cost once above).
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-user-email', user.email ?? '');
    const finalResponse = NextResponse.next({ request: { headers: requestHeaders } });
    response.cookies.getAll().forEach((cookie) => finalResponse.cookies.set(cookie));
    return finalResponse;
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
