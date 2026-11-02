import { describe, expect, it } from 'vitest'
import { boxartKey, boxartUrl, matchBoxart } from './boxart'

const LISTING = ['Mega Man 2 (USA).png', 'Mega Man 2 (USA) (Virtual Console).png', 'Mega Man 2 (Europe).png', 'Mega Man 2 (1988-12)(Capcom)(US).png', 'Double Dragon III - The Sacred Stones (USA).png', 'Double Dragon (USA).png', 'Sonic & Knuckles (World).png', 'Ninja Gaiden II - The Dark Sword of Chaos (USA).png', 'Aladdin (Europe).png', 'Aladdin (Unl) [h1].png']
describe('cartridge box art matching', () => {
  it('normalises dump names the same way as titles', () => {
    expect(boxartKey('Double Dragon III_ The Sacred Stones.zip')).toBe(boxartKey('Double Dragon III - The Sacred Stones (USA).png'))
    expect(boxartKey('Flintstones 2, The (U).nes')).toBe('flintstones 2')
    expect(boxartKey('Ninja Gaiden 2: The Dark Sword of Chaos')).toBe(boxartKey('Ninja Gaiden II - The Dark Sword of Chaos (USA).png'))
  })
  it('prefers the original US cartridge over reissues and other regions', () => {
    expect(matchBoxart('Mega Man 2', LISTING)).toBe('Mega Man 2 (USA).png')
    expect(matchBoxart('Aladdin', LISTING)).toBe('Aladdin (Europe).png')
    expect(matchBoxart('Double Dragon', LISTING)).toBe('Double Dragon (USA).png')
  })
  it('falls back to the first game of a combined dump, and gives up rather than guess', () => {
    expect(matchBoxart('Sonic & Knuckles + Sonic The Hedgehog 3', LISTING)).toBe('Sonic & Knuckles (World).png')
    expect(matchBoxart('1200-in-1', LISTING)).toBeNull()
    expect(matchBoxart('Mega', LISTING)).toBeNull()
  })
  it('builds an encoded thumbnail URL for the system', () => {
    expect(boxartUrl('nes', 'Double Dragon (USA).png')).toBe('https://raw.githubusercontent.com/libretro-thumbnails/Nintendo_-_Nintendo_Entertainment_System/master/Named_Boxarts/Double%20Dragon%20(USA).png')
  })
})
