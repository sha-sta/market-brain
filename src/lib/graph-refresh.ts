// Pure logic for the always-mounted graph auto-refresh (see graph-refresher.tsx). The persistent
// graph should refetch when a normalization run finishes, regardless of which page you're on — not
// only while you sit on the Dump page watching the queue.

export const PENDING_POLL_MS = 3000; // poll fast while a dump is normalizing
export const IDLE_POLL_MS = 12000; // a light heartbeat when idle (still catches a dump from another page)

/** Refresh the graph when the in-flight normalization count DROPS (i.e. a dump just finished). A
 *  rising/equal count means work is still running or just started — nothing new to show yet. */
export function shouldRefreshGraph(prevPending: number, currentPending: number): boolean {
  return currentPending < prevPending;
}

export function pendingPollDelay(pending: number): number {
  return pending > 0 ? PENDING_POLL_MS : IDLE_POLL_MS;
}
