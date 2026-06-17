// Runs once when a Next.js server instance boots (not at build). We use it to surface env
// misconfiguration in the startup logs: `checkEnvAtBoot` warns (never throws) listing any missing
// required vars, so a bad deploy is visible immediately instead of failing cryptically on first use.
// Node runtime only — the Edge runtime doesn't expose the full process.env.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { checkEnvAtBoot } = await import("@/lib/env");
    checkEnvAtBoot();
  }
}
