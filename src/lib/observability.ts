// Single integration point for server-side error reporting. Today it writes one structured JSON line
// to stderr, which Vercel surfaces in the function logs — so failures that callers swallow to degrade
// gracefully (a page that won't fetch, a search that 429s) stop being invisible. To switch to Sentry
// later, replace the body with `Sentry.captureException(error, { extra: context })`; callers are
// unchanged. Never throws — reporting must not break a path that is already handling its failure.
export function reportError(error: unknown, context: Record<string, unknown> = {}): void {
  try {
    const e =
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { value: String(error) };
    console.error(JSON.stringify({ level: "error", ...context, error: e }));
  } catch {
    // reporting must never throw
  }
}
