# Bible App — Design

**Date:** 2026-07-21
**Status:** Approved, phased delivery

A full Bible reader inside AIHub Browser that reads like a physical book, with an
AI pastor grounded in the actual scripture text, verse highlighting, saving, and
sharing.

---

## Goals

- A reader that genuinely feels like turning pages in a book, not a slideshow.
- An AI pastor that answers questions, finds verses by topic, explains passages,
  and builds sermons — always citing **real** verses, never invented ones.
- Highlight, save, and annotate verses, persisted across restarts.
- Share a verse to the platforms people actually use.
- Works fully offline. No account, no per-request API dependency.

## Non-goals

- Original-language (Hebrew/Greek) tooling, interlinears, lexicons.
- Audio narration of scripture (the app already has generic Read Aloud).
- Multi-user or church-account features.
- Commentary from named theologians (copyrighted).

---

## Translation and licensing

**Ships with the World English Bible (WEB).**

The user asked for a modern, non-KJV translation. The two obvious candidates —
NIV (Biblica) and NKJV (Thomas Nelson) — are both copyrighted and require a paid
publishing licence to bundle in a distributed application. Shipping either
without a licence exposes the project to a takedown.

WEB is **public domain**, modern English (no "thee/thou"), and complete. It is
the closest freely distributable equivalent to what was asked for.

**Source:** `TehShrike/world-english-bible` — 66 per-book JSON files, 10.2 MB raw,
verse-level structure with `chapterNumber` / `verseNumber` / `value`.

The data layer is translation-agnostic (see below), so a licensed NIV/NKJV can be
dropped in later without touching the reader or the AI.

---

## Architecture

### Data pipeline (build-time, run once)

`scripts/build-bible.js`

1. Fetches the 66 WEB book files.
2. Normalizes the token stream (`paragraph start` / `paragraph text` / …) into a
   compact per-book shape, merging fragments that share a verse number.
3. Writes `src/renderer/src/assets/bible/<book>.json` plus a single `index.json`.

Committed to the repo. Builds never hit the network; the app never hits the
network. Expected footprint ~4–5 MB total, ~30–250 KB per book.

**Per-book file:**
```json
{ "id": "JHN", "name": "John", "chapters": [ [ { "v": 1, "t": "In the beginning…" } ] ] }
```

**index.json:**
```json
{ "translation": "WEB",
  "books": [ { "id": "GEN", "name": "Genesis", "testament": "OT", "chapters": 50 } ] }
```

Books lazy-load on demand, so opening the app parses one small file rather than
5 MB.

### Reader components

New tab page type `bible` (`aihub://bible`), registered exactly like `rewind` and
`watch`: `Tab.pageType` union → `App.tsx` lazy import + render case → Sidebar
`NAV_ITEMS` → CommandPalette page list.

Split into focused units rather than one large file:

| Component | Responsibility |
|---|---|
| `BiblePage.tsx` | Page shell: book/chapter navigation, panels, state wiring |
| `BookSpread.tsx` | Two-page spread layout, gutter, paper, shadows |
| `PageLeaf.tsx` | The 3D fold mechanics only — pointer drag, rotation, release |
| `VerseText.tsx` | Renders verses; selection, highlight rendering, tap targets |
| `VerseActions.tsx` | Action bar: highlight, save, note, share, ask pastor |
| `ShareSheet.tsx` | Share targets + verse-image export |
| `PastorPanel.tsx` | AI pastor chat, grounded results, sermon/devotional views |

### The page-turn

CSS 3D, not WebGL. The spread container carries `perspective`. The turning leaf
is an element with two faces (front = current recto, back = next verso) rotated
about the spine on `rotateY`.

- `pointerdown` on the page edge starts a drag; `pointermove` maps horizontal
  distance to rotation 0°→180° so the page **follows the finger**.
- A gradient overlay strengthens with rotation, so a shadow sweeps the facing page.
- On `pointerup`: past halfway or with enough velocity it completes the turn;
  otherwise it springs back. Momentum from pointer velocity.
- Keyboard (←/→), scroll wheel, and the nav buttons trigger the same animation
  path so behaviour is consistent.
- `will-change: transform` and `backface-visibility: hidden` keep it on the
  compositor at 60fps.

WebGL paper-curl was considered and rejected: heavy dependency, stutters on
weaker machines, drains battery, and the gain over a well-tuned CSS fold is not
worth it for long-form reading.

### Persistence

`bible-marks.json` in `APP_DIR`, using the existing `readJson`/`writeJson`
pattern.

```json
{ "highlights": { "JHN.3.16": "yellow" },
  "saved": [ { "ref": "JHN.3.16", "ts": 0 } ],
  "notes": { "JHN.3.16": "text" },
  "lastRead": { "book": "JHN", "chapter": 3 } }
```

Verse references use a stable `BOOK.CHAPTER.VERSE` key so marks survive a
translation swap.

IPC: `bible:marks:get`, `bible:marks:set`, `bible:progress:get/set`.

### Sharing

Share targets open real web intents in the **system browser** via
`shell.openExternal` — the app never posts on the user's behalf.

Supported: Facebook, X/Twitter, LinkedIn, WhatsApp, Telegram, Reddit, email,
copy to clipboard.

**TikTok is deliberately not a link-share button.** TikTok is video-only and
exposes no web intent for sharing a text link; a button claiming to do so would
be dead. Instead the share sheet offers **Save as image**: the verse is rendered
to a canvas over a designed background and exported as PNG, which the user posts
to TikTok or Instagram themselves. This is also the more shareable artifact.

### AI pastor — grounding

LLMs hallucinate scripture references confidently. The pastor therefore never
answers from model memory alone.

1. The question runs through a **local verse retriever** over the bundled text —
   the same keyword-scoring approach already proven in the Rewind search
   (`rewind:search`), scoring on term frequency with weighting and returning
   snippets.
2. The top-K matching verses (with references) are injected into the system
   prompt as authoritative context.
3. The model composes pastoral prose **around those supplied verses** and is
   instructed to cite only from them and never fabricate a reference.

Runs on the existing `ai:chat` (Ollama, falling back to OpenRouter). No new AI
infrastructure. Verse lookup is local and instant; only prose generation is
model-bound.

Capabilities:

- **Ask anything** — pastoral answers with cited verses.
- **Topical finder** — "verses about money / righteousness / grief" → ranked real
  verses, each jumping straight to the passage.
- **Explain this verse** — plain meaning, context, cross-references, application.
- **Sermon builder** — topic or passage → hook, points with supporting verses,
  illustrations, closing. Exportable to Sticky Notes.

Tone: warm, pastoral, denominationally neutral. It presents scripture and
historic Christian teaching; it does not adjudicate contested doctrine between
denominations, and it defers to the reader's own church on those questions.

### Reading plans and devotional

`bible-plans.json` in `APP_DIR`: plan definitions plus per-plan progress.
Includes Bible-in-a-year and topical plans (faith, money, grief, marriage).
Verse of the day is a deterministic pick by date from a curated reference list,
so it is stable across restarts and needs no network.

---

## Delivery phases

Each phase is independently useful and ships as its own release.

**Phase 1 — The book**
Data pipeline, `bible` page type and navigation, two-page spread, 3D page-turn,
verse selection, highlighting, saving, notes, share sheet.

**Phase 2 — The pastor**
Verse retriever, grounded pastor chat, topical finder, explain-this-verse,
sermon builder.

**Phase 3 — The habit**
Devotional / verse of the day, reading plans with progress, verse-image export.

---

## Testing

- **Pipeline:** unit tests asserting 66 books, correct chapter counts against a
  known table, verse counts for sampled chapters, and that no verse text is empty.
- **Retriever:** unit tests that known topical queries return expected references
  (e.g. "money" surfaces 1 Tim 6:10, Matt 6:24) and that every returned reference
  resolves to a real verse in the bundled text.
- **Marks store:** round-trip tests for highlight/save/note persistence.
- **Reader:** manual verification of the turn at 60fps, drag-follow, spring-back,
  and keyboard parity.

## Risks

| Risk | Mitigation |
|---|---|
| Repo grows ~5 MB | Acceptable; per-book lazy load keeps runtime cost near zero |
| AI invents a reference | Retrieval-grounded prompt; only supplied verses may be cited |
| Page-turn jank on weak GPUs | Compositor-only transforms; reduced-motion fallback to a cross-fade |
| Licensed translation wanted later | Data layer is translation-agnostic by design |
