import type { DjEngine } from '../engine/DjEngine'

/**
 * 0..1 loudness for the stage's beat glow: the loudest playing deck.
 * Meters live on each Deck — DjEngine has no master meter, which is why the
 * first version (calling engine.meterDb) never moved.
 */
export function stageLevel(engine: Pick<DjEngine, 'decks'>): number {
  let db = -60
  for (const d of Object.values(engine.decks)) if (d.playing) db = Math.max(db, d.meterDb())
  return Math.max(0, Math.min(1, (db + 40) / 40))
}
