// French text → the IPA the Kokoro model reads.
//
// kokoro-js only phonemizes English: its bundled espeak carries no other
// language data. The model itself was trained with a French voice (ff_siwis)
// on espeak-ng's fr-fr phonemes, so French goes through a full espeak-ng
// build instead and is handed to the model as token ids.
//
// espeak drops punctuation, and the model needs it — it is where the pauses
// and the falling or rising tone come from. espeak does put each clause on its
// own output line, one per , ; : . ! ? in the text, so the punctuation is put
// back by position (rejoinClauses, which is the unit-tested part).

import { readFileSync } from 'fs'
import ESpeakNg from 'espeak-ng'

const CLAUSE_PUNCT = /[,;:.!?…]+/g

/**
 * Reattach the text's clause punctuation to espeak's per-clause lines. When
 * the counts disagree (a clause break espeak saw that the regex did not),
 * the lines are joined with commas and closed with a full stop rather than
 * guessing which mark belongs where.
 */
export function rejoinClauses(output: string, text: string): string {
  const lines = output.split('\n')
    // "ʒə- nə-": espeak marks unstressed function words with a hyphen.
    .map(l => l.replace(/-/g, '').trim())
    .filter(Boolean)
  if (!lines.length) return ''
  const punct = text.match(CLAUSE_PUNCT) || []
  const aligned = punct.length === lines.length
  return lines
    .map((l, i) => l + (aligned ? punct[i] : i < lines.length - 1 ? ',' : '.'))
    .join(' ')
}

let compiled: Promise<WebAssembly.Module> | null = null

/** IPA for one sentence or clause-sized piece of French. */
export async function frenchPhonemes(text: string, wasmPath: string): Promise<string> {
  // Compile the 18 MB module once; each call still gets a fresh instance,
  // because the emscripten build runs espeak's main() once and exits.
  compiled ??= WebAssembly.compile(readFileSync(wasmPath))
  const mod = await compiled
  const espeak = await ESpeakNg({
    arguments: ['--phonout', 'out', '-q', '-b', '1', '--ipa=3', '-v', 'fr-fr', text],
    instantiateWasm(imports: WebAssembly.Imports, done: (i: WebAssembly.Instance, m: WebAssembly.Module) => void) {
      WebAssembly.instantiate(mod, imports).then(instance => done(instance, mod))
      return {}
    },
  })
  return rejoinClauses(espeak.FS.readFile('out', { encoding: 'utf8' }), text)
}
