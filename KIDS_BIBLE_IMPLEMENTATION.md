# Kids Bible — implementation notes

Two illustrated children's editions, English and French, alongside the WEB and
LSG texts. Verified by driving the built Electron app, not only by tests.

## What shipped

| | |
|---|---|
| Editions | `WEB-KIDS` (Kids Bible), `LSG-KIDS` (Bible Enfants) |
| Books | Genesis 1–11, Matthew 1–8, John 1–21 |
| Verses | 227 per language, in step verse for verse |
| Illustrations | 28 SVGs, every one referenced by at least one verse |

### Chapter numbering follows the canon

Kids chapter *N* retells canonical chapter *N*. Verse numbers are the
retelling's own — one kids verse gathers several canonical ones — but the
chapter is always real, which is what keeps a highlight, note or saved verse
landing on the same story when the reader switches versions.

The first attempt invented its own numbering, so kids "Genesis 5" was the
making of the animals while the real Genesis 5 is a genealogy. Every mark the
reader had made showed up on unrelated words.

### The editions are abridged

Each index lists only the books that exist, with the retelling's real chapter
count. The book picker therefore never offers a page that cannot open.

### Reading aloud

`ListenButton` passes `getTranslationMeta().locale` to speech synthesis, so the
French editions are read in French. Verified at runtime by intercepting
`speechSynthesis.speak`: `{ lang: "fr", text: "Genèse 1" }`.

**Caveat:** the voice itself comes from the operating system. On a machine with
no French voice installed, Windows falls back to an English voice still reading
French words. Installing a French voice in Windows Settings → Time & Language →
Speech fixes it; nothing in the app can.

### Picture-book layout

The kids editions render one verse per line with larger, more widely spaced
type and illustrations as full-width plates (tap to enlarge). The ordinary
versions keep the flowing prose column exactly as before.

## Illustrations

`src/renderer/src/assets/illustrations/*.svg`, resolved by an eager build-time
glob in `VerseText.tsx`.

They contain **no text**, because one file serves both languages — the first
set had English captions baked in, which were wrong in the French edition. A
test enforces this.

## Bugs found and fixed along the way

All four of these compiled, typechecked and built cleanly. Only running the app
or writing an asset-level test caught them.

1. **`getBook`'s `import.meta.glob` did not list the kids directories**, so
   every kids book threw `Missing asset` on open. The glob is static; a missing
   directory fails only at runtime. This shipped in v1.51.0.
2. **Indexes advertised all 66 books** against three real files.
3. **Indexes carried the adult chapter counts**, offering empty chapters.
4. **A version switch onto a book the new version lacks blanked the reader.**
   `getChapter` threw, `Promise.all` rejected, `setPages` never ran, and
   nothing appeared in the console. Now the reader falls back to a book the
   version has, and each chapter fetch settles independently.

## Tests

`src/renderer/src/assets/bible/kids-assets.test.ts` guards the failure modes
that are invisible to the compiler:

- every indexed book has a file; every stated chapter count is real
- no empty chapters or verses; verses numbered from 1 without gaps
- every referenced illustration exists on disk
- EN and FR carry the same books, chapters, verses and pictures
- no chapter numbered beyond the canonical book
- no text inside any illustration
- no orphan illustrations

## Verification

`npm run typecheck` clean · `npm test` 909 passing across 60 files ·
`npm run build` clean.

In the running app: Genesis, the Noah sequence and John 19–20 all render with
their plates (16 images on one spread, 0 broken); switching to a kids edition
while on Psalms lands on Genesis with text instead of a blank spread.

## Not done yet

- Only three books. Luke, Jonah, Daniel and 1 Samuel are the obvious next ones
  for children.
- The retellings and the artwork are original work in this repository, not a
  licensed children's translation or commissioned illustration.
