// Centralized, lazy environment access. Read server-side env through these accessors instead of
// `process.env.X!` so a missing/blank var throws a NAMED error at the boundary that needs it (the
// boot of that request path) rather than yielding `undefined` and a cryptic downstream crash.
//
// Deliberately NOT a monolithic boot-time validator: the CI e2e job and partial local setups run
// without feature keys (AI_GATEWAY_API_KEY, TOKEN_ENCRYPTION_KEY), so validating everything at import
// would 500 every page there. Each accessor validates only its own key, lazily + memoized — nothing
// runs at module load, so `next build` with placeholder env never trips. `checkEnvAtBoot` (wired in
// instrumentation) gives a non-throwing startup summary.
//
// NOT `import "server-only"` — the proxy/middleware and vitest import this. Browser code keeps static
// `process.env.NEXT_PUBLIC_*` references (Next only inlines static member access, not the dynamic
// `source[name]` lookups used here), so this module is server-side only by construction.
import { z } from "zod";

const urlSchema = z.url();

type EnvSource = Record<string, string | undefined>;

/** Require a non-empty string env var from `source`, else throw naming it. Pure (testable). */
export function requireString(source: EnvSource, name: string): string {
  const v = source[name];
  if (v == null || v === "") throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

/** Require a valid-URL env var, else throw naming it. Pure (testable). */
export function requireUrl(source: EnvSource, name: string): string {
  const v = requireString(source, name);
  if (!urlSchema.safeParse(v).success) {
    throw new Error(`Environment variable ${name} must be a valid URL (got: ${v})`);
  }
  return v;
}

/** Optional string: undefined when absent or blank. Pure (testable). */
export function optionalString(source: EnvSource, name: string): string | undefined {
  const v = source[name];
  return v == null || v === "" ? undefined : v;
}

const REQUIRED_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "AI_GATEWAY_API_KEY",
  "CRON_SECRET",
  "TOKEN_ENCRYPTION_KEY",
] as const;

/**
 * Non-throwing startup summary: warns (once) listing any missing required keys so a misconfiguration
 * surfaces in the boot logs instead of as a cryptic runtime error. Never throws — safe during build
 * and in the CI e2e job (which intentionally omits feature keys). Pure (testable) via injected args.
 */
export function checkEnvAtBoot(source: EnvSource = process.env, warn: (m: string) => void = console.warn): void {
  const missing = REQUIRED_KEYS.filter((n) => {
    const v = source[n];
    return v == null || v === "";
  });
  if (missing.length > 0) {
    warn(`[env] missing required variables (paths that need them will fail at use): ${missing.join(", ")}`);
  }
}

function memo<T>(fn: () => T): () => T {
  let cached: { v: T } | undefined;
  return () => (cached ??= { v: fn() }).v;
}

// --- Memoized server-side accessors (read process.env on first call) ---
export const supabaseUrl = memo(() => requireUrl(process.env, "NEXT_PUBLIC_SUPABASE_URL"));
export const supabaseAnonKey = memo(() => requireString(process.env, "NEXT_PUBLIC_SUPABASE_ANON_KEY"));
export const supabaseServiceRoleKey = memo(() => requireString(process.env, "SUPABASE_SERVICE_ROLE_KEY"));
export const aiGatewayKey = memo(() => requireString(process.env, "AI_GATEWAY_API_KEY"));
export const cronSecret = memo(() => requireString(process.env, "CRON_SECRET"));
export const tokenEncryptionKey = memo(() => requireString(process.env, "TOKEN_ENCRYPTION_KEY"));

/** Optional — undefined when unset (feature dormant). */
export const tavilyApiKey = (): string | undefined => optionalString(process.env, "TAVILY_API_KEY");

/** Optional contact email for OpenAlex's "polite pool" (friendlier rate limits). No key; lookups work
 *  without it. */
export const openalexMailto = (): string | undefined => optionalString(process.env, "OPENALEX_MAILTO");
