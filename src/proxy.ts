import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

// Next.js 16: "Middleware" is now "Proxy" (proxy.ts). Same functionality.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Run on everything except Next internals, static assets, and API routes. API routes do their
  // own auth (CRON_SECRET for cron endpoints; getProfile/admin for connect) — gating them here
  // would redirect the unauthenticated cron callers to /sign-in before their own check runs.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
