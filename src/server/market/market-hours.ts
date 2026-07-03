// The US market close ("4:30pm ET") the morning brief measures news against. The 7am ET cron should
// carry only what the reader hasn't already seen live during the trading day — news published after
// the previous close (after-hours + overnight + pre-market), not the full prior day. The close is
// always US Eastern regardless of the recipient's timezone; a Monday morning resolves to Friday's
// close (weekends are skipped). Market holidays are not modeled (a holiday just anchors to the prior
// weekday's 4:30pm, which is harmless for a "what's new" window).

const MARKET_TZ = "America/New_York";
const CLOSE_HOUR = 16;
const CLOSE_MINUTE = 30;
const DAY_MS = 86_400_000;

/** Offset (local wall clock minus UTC) in ms for `tz` at the instant `atMs`. */
function tzOffsetMs(tz: string, atMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(atMs));
  const p: Record<string, number> = {};
  for (const part of parts) if (part.type !== "literal") p[part.type] = Number(part.value);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - atMs;
}

/** ET calendar year/month/day for an instant. */
function etYmd(ms: number): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MARKET_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const p: Record<string, number> = {};
  for (const part of parts) if (part.type !== "literal") p[part.type] = Number(part.value);
  return { y: p.year, m: p.month, d: p.day };
}

/** Epoch ms of CLOSE_HOUR:CLOSE_MINUTE ET on the given ET calendar date (DST-correct). */
function closeMsForEtDate(y: number, m: number, d: number): number {
  const guess = Date.UTC(y, m - 1, d, CLOSE_HOUR, CLOSE_MINUTE, 0);
  // Correct the UTC guess by the tz offset at that instant; a second pass settles DST-edge cases.
  const once = guess - tzOffsetMs(MARKET_TZ, guess);
  return guess - tzOffsetMs(MARKET_TZ, once);
}

function isWeekendEt(ms: number): boolean {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: MARKET_TZ, weekday: "short" }).format(new Date(ms));
  return wd === "Sat" || wd === "Sun";
}

/**
 * The most recent weekday 4:30pm ET strictly before `nowMs`. At the 7am ET cron this is the prior
 * trading day's close; on a Monday it falls back to Friday's close (skipping the weekend).
 */
export function lastMarketCloseMs(nowMs: number): number {
  let { y, m, d } = etYmd(nowMs);
  let close = closeMsForEtDate(y, m, d);
  // Walk back one ET day at a time until the close is in the past AND lands on a weekday.
  while (close >= nowMs || isWeekendEt(close)) {
    ({ y, m, d } = etYmd(close - DAY_MS));
    close = closeMsForEtDate(y, m, d);
  }
  return close;
}
