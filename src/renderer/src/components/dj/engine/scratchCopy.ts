/** Mono, at half rate when that is still ≥ 22 kHz — scratching needs character, not hi-fi. */
export function scratchCopy(chans: Float32Array[], rate: number): { data: Float32Array; rate: number } {
  const step = rate >= 44100 ? 2 : 1
  const n = Math.floor(chans[0].length / step)
  const out = new Float32Array(n)
  const k = 1 / (chans.length * step)
  for (const ch of chans) {
    for (let i = 0; i < n; i++) {
      let s = 0
      for (let j = 0; j < step; j++) s += ch[i * step + j]
      out[i] += s * k
    }
  }
  return { data: out, rate: rate / step }
}
