let turn: Promise<unknown> = Promise.resolve();

/**
 * SQLite allows one transaction at a time on a connection. Two quick taps on the Record screen would start two at once
 * ("cannot start a transaction within a transaction"), so work that needs a transaction waits for the previous one here.
 * A failure does not block the ones after it.
 */
export function inOrder<T>(work: () => Promise<T>): Promise<T> {
  const run = turn.then(work, work);
  turn = run.catch(() => {});
  return run;
}
