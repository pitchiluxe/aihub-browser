# AI DJ Stage — Design

Date: 2026-10-12
Status: approved in conversation (sections 1–4 + revision after probe and new requests), pending written-spec review

## Intent

**What the user asked for:** make AIHub DJ "best features and professional
looks… like never seen before in terms of result and use." Choices made:

- Primary use **A — AI DJ listening**: the user describes a vibe and AIHub
  builds and mixes a continuous set live; the existing console stays behind
  "Take the decks".
- Track selection **D — balanced blend**: flow governs order and transitions,
  favourites anchor the set, ~1 in 4 tracks is a discovery; a live
  familiar ↔ discovery slider moves the balance.
- Stage **C — hybrid**: music video when the track has one (crossfading with
  the mix), beat-reactive visualizer otherwise.
- Architecture **approach 1 — measured planner**: tempo/key/energy are
  measured from audio, never invented by a language model.

**Problem today:** `aihub://dj` is a feature-complete VirtualDJ-style
console (2 decks, stems, FX, loops, sampler, video, library, Automix, AI DJ
tab). It reads as a clone of existing pro apps and is dense for someone who
wants a great set without operating a console. Automix reacts track by
track; it cannot order a set for flow because YouTube tracks' tempo and key
are unknown until they play.

**Success:** from one sentence or a preset, AIHub plays a set that flows —
tempo-compatible, key-compatible transitions, an intentional energy arc,
mostly familiar music with discoveries mixed in — on a cinematic stage that
explains each pick and can be steered with one tap, without freezing the app
and without waiting on a slow local AI model.

**Assumptions (not stated by the user):** YouTube and local files remain the
only sources; sets of 20 minutes to 4 hours; one set at a time per window;
English UI text.

## Existing pieces reused

| Piece | File | Used for |
|---|---|---|
| Deck engine, YouTube decks (hidden player windows + tab capture) | `components/dj/engine/DjEngine.ts`, `engine/youtubeDeck.ts`, `src/main/dj/youtubeDeck.ts` | Playback |
| Silent scan player | `engine/youtubeScan.ts` (runs at 4× for waveforms) | Pre-analysis at **2×**, extended to collect audio |
| Tempo / key analysis | `engine/analysis.ts` (`measureTempo`), `engine/key.ts` (Camelot) | Track facts |
| AutoMixer + transitions | `engine/autoMixer.ts`, `engine/transitionFx.ts` | Executing transitions |
| Taste learning | `taste.ts`, `listeningTracker.ts` | Familiar/disliked scoring |
| Rule command parser, fallback searches, energy store | `djBrain.ts` | Steering, brief fallback |
| Video blend | `VideoMonitor.tsx` | Stage backdrop |
| YouTube search | `src/main/youtubeSearch.ts` | Candidates |

## Architecture

```
Set brief (vibe · duration · energy arc · discovery share)
        │
CandidatePool ──► SetPlanner (pure) ──► SetConductor (lookahead = 3)
  favourites/liked     flow + taste +         │        ▲
  local library        discovery fit          ▼        │ facts
  YouTube search                        AnalysisQueue ─┘
  (AI seeds → rule fallback)            2× scan → tempo, key, energy, cue points
                                              │
                         AutoMixer + transitionFx (existing) ──► decks
                                              │
                         Stage UI ◄── state: now / next / why / energy / steering
```

### Units

| Unit | File (under `src/renderer/src/components/dj/`) | Responsibility |
|---|---|---|
| `SetBrief` | `ai/setBrief.ts` | Parse a brief into `{ vibe, durationMin, curve: EnergyPoint[], discoveryShare }`; rule parser for presets and common phrasing ("2h", "peak at 11", "warm-up into"), AI model only for the rest |
| `CandidatePool` | `ai/candidatePool.ts` | Collect candidates from taste favourites/likes, local library and YouTube searches; dedupe by `videoId` / path; mark `known` (played before) vs `discovery` |
| `TrackFacts` | `ai/trackFacts.ts` | Per-track `{ bpm, bpmConfidence, camelot, keyConfidence, energy, introEndSec, outroStartSec, playable }`; persisted through the debounced async JSON store, capped at 5,000 entries |
| `AnalysisQueue` | `engine/analysisQueue.ts` | Sequential pre-scan of lookahead tracks at 2× (YouTube via a scan player extended to collect audio; local files via direct decode); one scan player at a time; pauses during transitions |
| `SetPlanner` | `ai/setPlanner.ts` | Pure ranking of candidates for the next slot; returns score parts for "why" |
| `SetConductor` | `ai/setConductor.ts` | Owns the set: keeps 3 tracks of analysed lookahead, hands the next track to the AutoMixer, applies steering, pauses/resumes around "Take the decks" |
| Stage | `stage/StagePage.tsx`, `stage/NowCard.tsx`, `stage/NextStrip.tsx`, `stage/EnergyGraph.tsx`, `stage/SteerBar.tsx`, `stage/Backdrop.tsx`, `stage/Visualizer.tsx`, `stage/StartScreen.tsx`, `stage/stage.css` | UI |
| Page switch | `DjPage.tsx` | Stage is the default view; "Take the decks" shows the console over it |

## Planner scoring

| Part | Rule |
|---|---|
| Tempo fit | Full within ±3% of current tempo or of its half/double; linear taper to 0 at ±8%; beyond ±8% only when the curve calls for a tempo change, and then transition style is echo-out or filter sweep |
| Key fit | Camelot same / ±1 / relative (A↔B same number) = 1.0; ±2 = 0.5; else 0.2 |
| Energy fit | 1 − distance between track energy and the curve target at the track's planned start |
| Taste | From `taste.ts` profile: liked artist/genre boosts, skipped penalised, disliked tracks excluded |
| Discovery quota | Target share from the slider (default 0.25); next pick favours whichever side the running share is behind |
| Freshness | No track repeats within a set; no artist within 45 minutes |
| Unknown facts | Low-confidence tempo/key → neutral 0.5 flow parts and a non-beat-matched transition |

## Stage UI

- Full-bleed backdrop: music video (A/B crossfade with the mix, existing
  `VideoMonitor` blend) or a beat-reactive visualizer (colour from the key,
  motion from energy and beat grid) when there is no video.
- Now-playing card: title, artist, BPM, Camelot key, energy, progress, and
  the planner's "why" line.
- Up-next strip: next track with time to transition, BPM/key with a
  compatibility mark, "new to you" badge; two more after it.
- Energy graph: planned curve dotted, played solid, "you are here"; dragging
  a point re-plans the lookahead.
- Steering bar: Skip, ♥, More energy, Calmer, More like this,
  familiar ↔ discovery slider, text/voice box ("play some Wizkid") through
  the existing rule parser then the AI model.
- Transition caption during each mix, e.g. "bass swap · 104→104 · 8A→9A".
- Start screen: "What's the vibe?" prompt, preset chips (Warm-up, Peak hour,
  Late night, Focus, Workout), duration picker, one-click start.
- "Take the decks" slides the console over the stage (same engine); "Back to
  stage" returns and the conductor resumes from what is playing.
- Look: dark cinematic, brand red accent, large type, glass cards; cards
  follow the app theme, backdrop stays dark; fills the tab without
  scrolling; bottom-sheet layout on narrow windows.

## Probe findings (2026-10-12) and analysis changes

Scanned real YouTube songs in the built app (hidden player, tab capture,
`keyLock` off so speed-up is exact time compression), analysed with the
app's own `detectBpm` / `detectKey`:

| Song | 4× | 2× | 1× | True |
|---|---|---|---|---|
| Get Lucky | 115.4 · 11A | — | — | 116 · 11A |
| Shape of You | 126.3 · 12A | 96.0 · 11A | 96.0 · 11A | 96 · 12A |
| Levitating | 103.4 · 1B | 103.4 · 11A | — | 103 · 10A |
| Happy | 107.0 · 4A | — | 106.0 · 4A | 160 · 4A |
| Blinding Lights | 115.4 · 6B | 115.4 · 4A | 115.4 · 4A | 171 · 4A |

Decisions:
- **Scan at 2×** (4× loses accuracy; 2× matches 1×). A 4-minute song is read
  in ~2 minutes, still within one track's playtime.
- **Fix `detectBpm`'s ⅔ confusion** (Happy and Blinding Lights read ⅔ of the
  true tempo even at 1×). This also fixes the BPM the existing console shows.
- Keys with confidence < 0.4 count as low-confidence (neutral key score).

## Following instructions

Measured today (`parseCommand`): "no more slow songs" and "no slow songs" →
chill (the opposite); "play Calm Down by Rema next" → chill; "play my
favorites" / "play only afrobeats" / "play 3 Wizkid songs then Davido" are
searched literally; "don't play Drake", "stick to amapiano", "switch to
amapiano", "keep it under 110 bpm", "less hip hop", "avoid explicit songs",
"stop after this song", "keep the energy high for the next hour" are not
understood and fall through to a slow or failing model.

Design:
- **Set rules** — standing constraints held by the conductor and enforced by
  the planner on every pick until removed: `banArtist`, `onlyGenres` /
  `lessGenre` / `moreGenre`, `tempoRange`, `minEnergy` / `maxEnergy` (with
  optional expiry, e.g. "for the next hour"), `noExplicit` (title/metadata
  markers), `stopAfterCurrent`, `sequence` (e.g. 3 × Wizkid then Davido),
  `playNext` (a specific song).
- **Instruction parser** (`ai/instructions.ts`) — replaces keyword matching
  for steering: handles negation scope ("no more slow songs" → `minEnergy`),
  quoted or "X by Y" song titles before mood words, references ("my
  favorites" → favourites pool, "never heard" → discovery 100% for N tracks),
  sequences, durations, and the existing one-shot actions (skip, pause,
  volume, sampler hits).
- **Model fallback** only for unparsed text; its reply must be the same
  rule/action JSON (whitelisted fields); anything else is dropped and the
  stage says what it could not do.
- **Confirmation** for every instruction ("Got it — no Drake for the rest of
  the set"), and an **active-rules chip row** on the stage; tapping a chip
  removes the rule.

## Stage themes

Each theme is a distinct experience — its own layout composition,
typography, motion and visualizer — over the same conductor state and
controls. The console's existing 12 colour themes are unchanged.

| Theme | Character |
|---|---|
| Cinema (default) | Full-bleed video, glass cards |
| Club Neon | Black, laser-line visualizer, giant BPM pulsing on the beat, condensed bold type, edge HUD |
| Vinyl Lounge | Warm analog: spinning record with album art at centre, serif type, cream/wood tones, slow motion |
| Minimal Studio | Light, Swiss-grid typography, full-width waveform timeline, no video |
| Festival | Sunset-gradient sky, huge now-playing type, crowd-energy meter, burst on drops |
| Radio | Compact "on air" strip for small windows |

A theme picker shows a live mini-preview of each; the choice persists.
Switching themes never interrupts playback.

## Failure handling

| Failure | Behaviour |
|---|---|
| Track cannot be scanned (stall, blocked, embed refused) | Marked unplayable for this set, replaced in the lookahead, never loaded on a deck |
| Tempo/key below confidence | Eligible with neutral flow scores and a safe transition |
| Lookahead empty | Widen seeds (related artists, genre neighbours), then relax tempo/key limits; never stop while a track plays |
| AI model slow or down | Rule-parsed brief and `fallbackQueries` seeds; stage notes "AI suggestions offline" |
| YouTube unreachable | Local library only; if empty, say so and offer to add a music folder |
| User takes the decks | Planning paused, lookahead kept warm, resume from current playback on return |
| Incognito window | Plays; no taste events, history or set log written |

## Performance

- One scan player at a time; scans paused during transitions.
- Tempo/key analysis off the main thread (audio worklet / existing analysis
  path); no synchronous disk I/O; `TrackFacts` via the debounced async store.
- Visualizer and stage animations pause when the tab is hidden; YouTube
  player pictures stay hidden unless the stage shows them (v1.70.4 fix).

## Testing

- **Tempo-detector regression tests:** real onset curves of Happy (160 BPM)
  and Blinding Lights (171 BPM), captured once into fixtures, must read
  within ±2 BPM (today both read ⅔: 106/107 and 115.4); existing
  `analysis.test.ts` cases keep passing.
- **Live scan check:** the 5 probe songs scanned at 2× in the built app —
  tempo within ±2 BPM on ≥4/5 and key within Camelot ±1 on ≥4/5.
- **Instruction corpus:** ≥40 real phrasings (every failing phrase in
  "Following instructions" included) each map to the expected action or
  rule; none map to an opposite action.
- **Themes:** each theme renders now/next/steering and switches without
  interrupting playback.
- Unit: `SetBrief` parsing; every `SetPlanner` rule; `SetConductor`
  lookahead refill, skip, steering, take-the-decks pause/resume (fake decks,
  fake scanner); `TrackFacts` cap and confidence handling.
- UI: stage shows now/next/why; steering calls the conductor; energy-graph
  drag re-plans; start-screen presets start a set.
- Live end-to-end: 20-minute "Afrobeats warm-up" set in the built app;
  ≥3 tracks played, ≥2 transitions completed, no silence > 2 s, tempo within
  the planned band, no main-process stall > 250 ms.

## Out of scope

New audio sources (Spotify, SoundCloud), streaming/broadcast output, MIDI
controllers, multi-room playback, changes to the console's own features.
