// Pure throttle for the structural gap-fill pass (no IO) so it unit-tests in isolation. Gap-fill grounds
// essential identity facts on tracked companies — but it adds nothing new most days, so it runs at most
// once per interval (default weekly), tracked by graphs.last_gap_fill_at.

const DAY_MS = 86_400_000;

/** Is a graph due for a gap-fill pass? Due when never run, or the interval has elapsed since the last
 *  run. An unset/invalid timestamp is treated as due (run it). Pure. */
export function gapFillDue(lastIso: string | null, nowMs: number, intervalDays = 7): boolean {
  if (!lastIso) return true;
  const t = Date.parse(lastIso);
  if (Number.isNaN(t)) return true;
  return nowMs - t >= intervalDays * DAY_MS;
}
