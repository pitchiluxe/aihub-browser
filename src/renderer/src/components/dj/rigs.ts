/**
 * Reference rigs: the skins modelled on specific pieces of DJ hardware.
 *
 * Designs (designs.ts) swap which deck/meter/knob parts a look is built from.
 * A rig goes further for the hardware-replica skins: it says which platter
 * the deck carries (a silver jog with a centre LCD or a vinyl record), what
 * sits on the record's label, and which display the mixer has. Every part is
 * live — the jog LCD and mixer screen read the decks; nothing is decoration
 * that pretends to be a control. Looks without a rig render exactly as before.
 */
import { createContext, useContext } from 'react'

/** silver: a machined jog with a stepped hub and blue LCD; vinyl: a record under a tonearm. */
export type RigPlatter = 'silver' | 'vinyl'
/** What sits on the label when the song has no artwork: the AIHub logo, or a red power cap. */
export type RigLabel = 'logo' | 'power'
/** The mixer's centre display: an amber scope (Technics), blue LCD (Pioneer) or red LEDs (battle mixers). */
export type RigScreen = 'amber' | 'blue' | 'red' | 'none'

export interface Rig { platter: RigPlatter; label: RigLabel; screen: RigScreen }

export const RIGS: Record<string, Rig> = {
  'silver-wave': { platter: 'silver', label: 'logo', screen: 'amber' },
  'silver-classic': { platter: 'silver', label: 'logo', screen: 'none' },
  'classic-1200': { platter: 'vinyl', label: 'logo', screen: 'none' },
  'battle-art': { platter: 'vinyl', label: 'power', screen: 'red' },
  'battle-black': { platter: 'vinyl', label: 'power', screen: 'red' },
  'ember-vinyl': { platter: 'vinyl', label: 'logo', screen: 'blue' },
}

export function rigFor(look: string): Rig | null {
  return RIGS[look] ?? null
}

export const RigContext = createContext<Rig | null>(null)
export const useRig = () => useContext(RigContext)
