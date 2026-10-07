/**
 * Tracks a kind of request where only the latest one matters (e.g. the product list of the
 * selected expansion): `start()` returns a check that stays true until another request starts
 * or `cancel()` is called, so responses arriving out of order can be discarded.
 */
export function latestRequest() {
  let current = 0;
  return {
    start(): () => boolean {
      const id = ++current;
      return () => id === current;
    },
    cancel(): void {
      current++;
    },
  };
}
