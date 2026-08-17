# Bible Study, Classroom and Lab — Design

**Date:** 2026-08-16
**Status:** Approved, phased delivery
**Builds on:** [2026-07-21-bible-app-design.md](2026-07-21-bible-app-design.md)

A learning layer over the existing Bible reader: a daily verse to meditate on, a
self-directed study desk, authored courses, and a drill room that uses spaced
repetition so verses actually stay remembered.

---

## Goals

- A daily verse that is the same all day, survives restarts, and needs no network.
- Memorisation that works: a scheduler that brings a verse back exactly when it
  is about to be forgotten, not on a fixed daily grind.
- Structured courses a reader can work through alone, start to finish.
- Quizzes built from the scripture the reader is actually studying, with
  distractors taken from real verses — never invented text.
- Rewards that point back into the app: streaks, per-verse mastery, and
  milestones that unlock reader styles.
- Everything works with the AI turned off.

## Non-goals

Inherited from the Bible app design and still binding:

- Multi-user, teacher/student, or church-account features. Classroom is a room
  you study in alone, not a class someone teaches.
- Original-language tooling, audio narration, named-theologian commentary.

New to this feature:

- No leaderboards, XP bars, or numeric levels. There is nobody to compete with
  in a single-user app, and points-for-their-own-sake cheapen the subject.
- No AI-generated lesson or quiz content at runtime. Content is authored and
  shipped; AI only ever enriches what is already there.

---

## Architecture

### Where it lives

A new page type, `study`, reached at `aihub://study`, parallel to `bible`.

`BiblePage.tsx` is already 763 lines and is a *reader*. Study is a different
activity with different chrome, so it gets its own component tree rather than
more state inside the reader. The two cross-link: the reader's toolbar gains one
button into the study page, and a lesson's passages open in the reader.

### Rooms

**Landing — Daily Verse.** The card the page opens on: the verse, one line of
context, and three actions — *Meditate* (marks the day done, feeding the
streak), *Open in reader*, *Add to Lab*.

**Study.** The self-directed desk. Reading plans with progress, every saved and
highlighted verse gathered in one place, and notes. Reads and writes the
existing `BibleMarks`; adds no new verse state of its own. Plan *definitions*
ship as JSON assets beside the courses — the `bible-plans.json` idea from the
original design, relocated so plans and courses load through one path; plan
*progress* lives in `bible-study.json` with everything else.

**Classroom.** Three authored courses, six lessons each. A lesson is teaching
text, the passages to read, and an end-of-lesson quiz. Courses ship as JSON
assets, so a fourth course is a data change, not a code change.

**Lab.** The drill room, fed by the spaced-repetition queue.

### Exercise types

Chosen by box level, so difficulty rises with mastery:

| Box | Exercise | What it asks |
|-----|----------|--------------|
| 1 | reference → text | pick the verse from four options |
| 2 | fill the blank | one keyword removed |
| 3 | first letters | `F___ G__ s_ l____ t__ w____` |
| 4 | scramble | put the phrases back in order |
| 5 | type from memory | free recall, graded on normalised text |

Distractor verses are drawn from the same book as the answer, so the choice is
between real, plausible scripture rather than obvious filler.

### The scheduler

Leitner boxes, 1–5:

| Box | Next review |
|-----|-------------|
| 1 | 1 day |
| 2 | 3 days |
| 3 | 7 days |
| 4 | 21 days |
| 5 | 60 days |

Correct promotes one box; wrong drops straight to box 1. Box level *is* the
mastery level, so the scheduler and the rewards read the same number and cannot
disagree.

SM-2 was considered and rejected: per-item ease factors are invisible to the
reader and buy nothing at the scale one person memorises verses. A fixed daily
review of everything was rejected too — past roughly forty verses it drills
what is already known cold, which is how people quit.

### Services

Pure, individually testable, no Electron and no network:

| File | Responsibility |
|------|----------------|
| `bibleSrs.ts` | box + result → new box and due date; which verses are due now |
| `bibleQuiz.ts` | build each exercise type from a verse and a distractor pool |
| `dailyVerse.ts` | date → reference, deterministic |
| `bibleRewards.ts` | streak from a date list, badge evaluation, unlock gating |
| `bibleCourses.ts` | load and validate course JSON, track lesson progress |

### Components

`BibleStudyPage.tsx` is a shell: room switcher and routing only. Each room is
its own component (`DailyVerse`, `StudyDesk`, `Classroom`, `LessonView`, `Lab`,
`DrillRunner`, `ProgressPanel`), so no single file repeats the reader's growth
into something too large to hold in your head.

### Determinism

Both the daily verse and a given day's quiz are seeded by date. The verse
chosen for meditation must not change when the page remounts, and a drill
should not silently reshuffle underneath someone mid-session.

---

## Persistence

A new file, `bible-study.json` in `APP_DIR`, behind `bible:getStudy` and
`bible:setStudy`. It reuses the atomic-write-with-backup path `bible:setMarks`
already uses, and joins the app backup payload.

```
{
  verses:  { "JHN.3.16": { box: 3, dueAt: 1760000000000, lastResult: "pass" } },
  lessons: { "life-of-christ/03": { completedAt: 1760000000000, score: 5 } },
  streak:  { days: ["2026-08-14", "2026-08-15"], best: 12 },
  badges:  ["verses-25", "course-parables", "streak-7"]
}
```

Deliberately separate from `BibleMarks`: a corrupt study file must never cost
someone their highlights and notes. The reverse holds too — study progress
survives a reset of the reader's marks.

Unlockables extend `BibleSettings` with new `paper` and cover values that the
Settings UI offers only once the matching badge is earned.

---

## AI

Optional in every room. With Ollama off and no OpenRouter credit, the daily
verse, all five exercise types, every lesson, the scheduler and the rewards work
exactly as designed.

Where AI is available, the existing grounded `BibleAssistant` adds one
affordance: *explain this* on a lesson passage or a verse just missed in a
drill. It uses the same passage-grounding rules already specified — real verses
only — and the same calm single-sentence degradation when a provider is
unavailable.

---

## Content

Three courses, six lessons each, authored as part of this work:

- **Life of Christ** — birth, baptism and temptation, ministry, transfiguration,
  passion, resurrection.
- **The Parables** — sower, prodigal son, good Samaritan, talents, lost sheep,
  sheep and goats.
- **Psalms for Hard Days** — grief, fear, guilt, waiting, anger, thanksgiving.

Lesson prose is written plainly and doctrinally neutral: it teaches what the
text says and the historical setting, and leaves contested interpretation to the
reader. Where traditions differ materially, the lesson says so rather than
picking a side.

The curated daily-verse list is roughly 200 references spanning both testaments,
weighted toward verses worth sitting with rather than genealogies.

---

## Delivery phases

Each phase is independently useful.

**Phase 1 — The habit**
`study` page type and navigation, daily verse, Lab with all five exercise types,
the scheduler, streaks, mastery, badges, unlockables, persistence.

**Phase 2 — The classroom**
Course loader and validation, the three courses, lesson view, end-of-lesson
quizzes, course-completion badges.

**Phase 3 — The desk**
Study room: reading plans with progress, saved and highlighted verses gathered,
notes.

---

## Testing

Unit tests, in the manner of `bibleSearch` and `normalize-bible`:

- **Scheduler** — promotion, demotion to box 1, due-date arithmetic, what is due
  at a given instant, and that a verse never skips a box on a single pass.
- **Quiz builders** — every exercise type produces a solvable question; the
  answer is always present among the options; distractors are real verses and
  never equal the answer; first-letter and blank masking leave the punctuation
  and word count intact.
- **Daily verse** — same date gives the same reference; different dates spread
  across the list; every reference in the list resolves to a real verse.
- **Rewards** — streak counts consecutive days and breaks on a gap; badges fire
  exactly at their threshold and never un-earn; unlocks gate correctly.
- **Courses** — every shipped course validates; every passage reference in every
  lesson resolves to a real verse.

Then a packaged-app smoke pass: launch the built binary, open `aihub://study`,
complete one drill of each type, finish a lesson, confirm progress survives a
restart.

---

## Risks

- **Authoring is the slow part.** Eighteen lessons of real prose is most of the
  effort in this feature; the code around it is comparatively small. Phasing
  exists so the memorisation engine ships without waiting on the writing.
- **A drill that feels like a test rather than devotion.** Mitigated by tone:
  no timers, no failure sounds, no streak-loss guilt messaging. A missed verse
  simply comes back tomorrow.
- **Doctrinal neutrality is a judgement call.** Where a lesson cannot be neutral
  it names the disagreement instead of resolving it.
- **`bible-study.json` corruption.** Same atomic-write-and-backup path as the
  marks file, and separation from `BibleMarks` bounds the blast radius.
