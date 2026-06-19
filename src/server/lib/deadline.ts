/** A soft-deadline check used to time-box the daily run's LLM-heavy steps (drain + thesis-judge) so the
 *  single 300s cron invocation always reserves budget for the digest send. `deadlineMs` is an ABSOLUTE
 *  epoch-ms timestamp (not a duration). `undefined` means "no deadline" => never past, so the non-cron
 *  callers (the dump-trigger drain, the manual sweep) stay unbounded exactly as before. */
export function pastDeadline(deadlineMs: number | undefined): boolean {
  return deadlineMs !== undefined && Date.now() >= deadlineMs;
}
