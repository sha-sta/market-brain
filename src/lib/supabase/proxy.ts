import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";
import { supabaseUrl, supabaseAnonKey } from "@/lib/env";

// Paths reachable without a session. Everything else requires login (status gating happens in
// the page DAL via requireActive/requireAdmin — proxy only does the optimistic login check).
const PUBLIC_PATHS = ["/sign-in", "/auth"];

function isPublic(path: string): boolean {
  return PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * Refresh the Supabase session on every request (writing rotated cookies onto the response) and
 * redirect unauthenticated users to /sign-in. The verified @supabase/ssr pattern: getAll from the
 * request, setAll onto both request and a rebuilt response, then getUser() (server-verified).
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    supabaseUrl(),
    supabaseAnonKey(),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublic(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    return NextResponse.redirect(url);
  }

  return response;
}
