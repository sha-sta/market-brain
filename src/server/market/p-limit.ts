// Bounded-concurrency async pool. No external dep exists in the repo and the enrichment loop needs
// to fan out across people without launching every page-fetch + LLM confirm at once. Pure (no IO):
// `run(fn)` resolves/rejects with fn's outcome; at most `concurrency` fns are in flight, the rest
// queue FIFO. A rejecting task frees its slot like any other, so one failure never stalls the pool.

export interface Limiter {
  run<T>(fn: () => Promise<T>): Promise<T>;
  readonly activeCount: number;
  readonly pendingCount: number;
}

export function pLimit(concurrency: number): Limiter {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`pLimit concurrency must be an integer >= 1, got ${concurrency}`);
  }

  const queue: Array<() => void> = [];
  let active = 0;

  const next = () => {
    if (active >= concurrency) return;
    const start = queue.shift();
    if (start) start();
  };

  const run = <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const start = () => {
        active++;
        Promise.resolve()
          .then(fn)
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      };
      queue.push(start);
      next();
    });

  return {
    run,
    get activeCount() {
      return active;
    },
    get pendingCount() {
      return queue.length;
    },
  };
}
