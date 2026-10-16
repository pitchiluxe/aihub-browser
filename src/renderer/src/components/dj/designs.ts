/**
 * Console designs: what a look is BUILT from, not just how it is painted.
 *
 * Most looks restyle the same hardware. The design looks swap the hardware
 * itself — the deck can be a turntable, a CDJ-style jog wheel, a controller
 * jog with an LED ring or a screen deck with a touch strip; meters can be
 * analog needles; knobs can be chicken-head pointers or LED rings — and their
 * CSS (dj-designs.css) rearranges the console and reshapes the buttons.
 * Every look not listed here keeps the original parts.
 */
import { createContext, useContext } from 'react'

export type DeckKind = 'turntable' | 'cdj' | 'ledjog' | 'screen'
export type MeterKind = 'led' | 'needle'
export type KnobKind = 'classic' | 'chicken' | 'ledring'

export interface DesignParts { deck: DeckKind; meter: MeterKind; knob: KnobKind }

export const CLASSIC_PARTS: DesignParts = { deck: 'turntable', meter: 'led', knob: 'classic' }

export const DESIGN_PARTS: Record<string, DesignParts> = {
  'walnut-hifi': { deck: 'turntable', meter: 'needle', knob: 'chicken' },
  'tube-amp': { deck: 'turntable', meter: 'needle', knob: 'chicken' },
  'obsidian': { deck: 'cdj', meter: 'led', knob: 'ledring' },
  'ocean': { deck: 'cdj', meter: 'led', knob: 'classic' },
  'mahogany': { deck: 'cdj', meter: 'needle', knob: 'chicken' },
  'titanium': { deck: 'ledjog', meter: 'led', knob: 'ledring' },
  'rose-gold': { deck: 'ledjog', meter: 'needle', knob: 'classic' },
  'concrete': { deck: 'screen', meter: 'led', knob: 'ledring' },
  'porcelain': { deck: 'screen', meter: 'needle', knob: 'classic' },
  'field-olive': { deck: 'screen', meter: 'needle', knob: 'chicken' },
}

export function partsFor(look: string): DesignParts {
  return DESIGN_PARTS[look] ?? CLASSIC_PARTS
}

export const DesignContext = createContext<DesignParts>(CLASSIC_PARTS)
export const useDesign = () => useContext(DesignContext)
