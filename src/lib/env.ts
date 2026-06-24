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

// --- Market data + email: all OPTIONAL. A missing key means that source/feature is DORMANT (the
// adapter degrades to []/null and the run continues) — never a boot failure. (Anthropic, SpaceX and
// other private companies have no quote API regardless of keys; callers guard on is_public.) ---

/** Finnhub — primary quotes + company news (free tier 60 req/min). */
export const finnhubKey = (): string | undefined => optionalString(process.env, "FINNHUB_API_KEY");

/** Financial Modeling Prep — profiles, earnings calendar, ratings/price-target deltas (free 250/day). */
export const fmpKey = (): string | undefined => optionalString(process.env, "FMP_API_KEY");

/** Alpha Vantage — news sentiment. Free tier is 25 calls/DAY (severe) — theme-level/optional only. */
export const alphaVantageKey = (): string | undefined => optionalString(process.env, "ALPHAVANTAGE_API_KEY");

/** SEC EDGAR is keyless but REQUIRES a User-Agent of the form "Name email@example.com" (SEC 403s
 *  without it). Returns undefined when unset — the EDGAR adapter then stays dormant rather than 403. */
export const secEdgarUa = (): string | undefined => optionalString(process.env, "SEC_EDGAR_UA");

/** Exa — open-web search + content extraction for gated research jobs. Dormant (no web research) when
 *  unset; the research loop then falls back to re-reading the current graph only. */
export const exaKey = (): string | undefined => optionalString(process.env, "EXA_API_KEY");

/** Max interactive research jobs per user per ET day (the cost quota). Default 5. */
export const researchDailyQuota = (): number => {
  const n = Number(optionalString(process.env, "RESEARCH_DAILY_QUOTA") ?? "5");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
};

// --- Email senders. PREFERRED for a personal gift: Gmail SMTP (no domain/DNS, delivers to any
// inbox). Resend is the alternative (needs a verified domain to reach arbitrary recipients). The cron
// uses Gmail when GMAIL_APP_PASSWORD is set, else Resend, else composes + archives only. ---

/** The Gmail address the brief is sent FROM (also the recipient if you don't set DIGEST_TO). */
export const gmailUser = (): string | undefined => optionalString(process.env, "GMAIL_USER");

/** A Google "App Password" (16 chars) for that account — NOT the normal password. Requires 2-Step
 *  Verification enabled, then Google Account > Security > App passwords. Dormant when unset. */
export const gmailAppPassword = (): string | undefined => optionalString(process.env, "GMAIL_APP_PASSWORD");

/** Resend — alternative sender. Free tier only delivers to your own account email unless a domain is
 *  verified. Dormant when unset. */
export const resendKey = (): string | undefined => optionalString(process.env, "RESEND_API_KEY");

/** Verified "From" address for the brief (falls back to Resend's onboarding sender). */
export const resendFrom = (): string | undefined => optionalString(process.env, "RESEND_FROM");

/** Recipient of the morning brief (the reader's email). */
export const digestTo = (): string | undefined => optionalString(process.env, "DIGEST_TO");

/** IANA timezone the brief's ET-date idempotency gate uses (default America/New_York). */
export const digestTz = (): string => optionalString(process.env, "DIGEST_TZ") ?? "America/New_York";
