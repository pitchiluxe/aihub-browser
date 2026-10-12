// src/shared/fares/watch.ts
/** Alert once when a watched fare crosses down to the target — not every check it stays there. */
export function fareWatchVerdict(prev: number | undefined, current: number | null, target: number): { notify: boolean; message: string } {
  if (current === null) return { notify: false, message: '' }
  const crossed = current <= target && (prev === undefined || prev > target)
  return crossed
    ? { notify: true, message: `Now $${current} — at or below your $${target} target${prev !== undefined ? ` (was $${prev})` : ''}.` }
    : { notify: false, message: '' }
}
