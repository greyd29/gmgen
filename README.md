# The Game Factory — ECS Prototype

## What this is

A prototype "discrete physics" engine for generating, simulating, and judging
2D games automatically. The long-term goal: a library of small atomic rules
("gravity", "line clear", "shoot", "pickup"...) that can be recombined into
new game configs, self-played by a generic AI agent, and scored for whether
the combination produced something *fair, decisive, and skill-rewarding* —
i.e. an actual game, not noise.

This repo is the **first working slice**: an Entity-Component-System (ECS)
core in plain JavaScript (no build step, runs in Node), 9 atoms, a
clone-based lookahead agent, and a test harness. It is NOT yet a generator —
the atom *combination* is currently hand-picked. The generator/recombination
layer and the Judge's automated verdicts are the next layer to build.

## Project history (why it looks like this)

The project went through several pivots, each one a deliberate simplification
or generalization. Understanding this history will save you from re-deriving
decisions that were already made for a reason:

1. **Started as a board-game factory** (chess-like games on small grids,
   single-cell pieces, "capture the royal" win condition). Worked well,
   produced a playable archive of 100 generated games + an AlphaZero-style
   trainer. See `docs/00-board-game-era.md` for what exists from that era
   and how it relates to this one (some of it may still be useful).

2. **User asked: no predefined win condition.** Goal became generated DNA
   too (annihilate / reach / collect / line). Still single-cell pieces on
   a grid.

3. **User asked: one-touch mechanic** ("touch a piece, it moves on its own").
   Built "Korin Drift" — a single polished game with rotating-arrow pieces
   that slide until they hit something. This was the last *board game*.

4. **User asked: remove the grid/single-cell assumption entirely.** Vision:
   400x254 continuous-ish space, multi-cell shapes (Tetris-style), ~1000
   rules mined from gaming history (Tetris to PUBG), recombined and
   self-played to find emergent patterns.

5. **Compromise reached** (this repo): keep a grid (small, e.g. 8x12) for
   tractability, but generalize the *primitive* from "piece on a square" to
   "entity = multi-cell shape + components", per the ECS architecture
   document the user provided (`docs/03-original-ecs-spec.md`). Start with
   ~9 atoms instead of 1000, hand-combined instead of auto-recombined.

## Current status (read this before doing anything else)

**Working:**
- ECS core (`src/engine.js`): flat-array components, entity recycling,
  grid <-> entity sync, `cloneWorld()` for AI lookahead (~1ms/call).
- 9 atoms covering movement, gravity, collision, shooting, damage, pickups,
  and "locking" (a faller stops being affected by gravity once it lands).
- Tick pipeline: input -> per-entity tick atoms -> event processing
  (bounded rounds) -> global tick atoms -> more event processing.
- Generic `lookaheadAgent`: clones the world, tries each of 5 inputs for N
  ticks, picks the one with the best `evaluate()` score. Goal-agnostic
  (reads `score[]` and `hp[]`/alive-count, not anything game-specific).

**Broken / not yet working — see `docs/02-known-issues.md` for full detail:**
- `lineClear` atom causes an entity-count explosion when combined with the
  faller-locking atoms (61 -> 960 entities in 20 ticks). Currently EXCLUDED
  from the demo combo. Needs redesign before re-adding.
- The current demo combo (`tests/demo.js`) is a "dud" — random play produces
  zero scoring events in 150 ticks. This is a *design* gap (players can only
  go left/right/rotate/shoot; pickups are placed somewhere they can't reach)
  not an engine bug. Good first task: add vertical movement or reposition
  pickups, then re-check.

**Not started:**
- The Generator/recombination layer (picking subsets of atoms automatically).
- The Judge's automated verdict (currently the metrics from the original
  spec — decisiveness, rule density, skill variance — are NOT implemented
  as code, only described in docs).
- Any rendering (Raylib or otherwise). Everything is headless/console so far.
- The "1000 rules from gaming history" library. Currently 9 hand-written atoms.

## Directory layout

```
gamefactory-ecs/
  README.md                 <- you are here
  src/
    engine.js                <- the ECS core + 9 atoms + lookahead agent (pure, no I/O)
  tests/
    demo.js                  <- node harness: builds a world, runs matches, prints stats
  docs/
    00-board-game-era.md      <- what exists from the previous (board game) phase
    01-architecture.md        <- how the ECS works: components, atoms, tick loop
    02-known-issues.md         <- the lineClear bug and the "dud combo" issue, in detail
    03-original-ecs-spec.md   <- the C++ architecture doc the user provided (source of truth
                                  for the *intended* design; this JS prototype is a faithful
                                  but simplified translation of it)
    04-next-steps.md          <- concrete, ordered suggestions for what to build next
```

## Running it

No dependencies, no build step.

```bash
node tests/demo.js
```

Expected output (current state): random-vs-random ends at the tick limit
with score [0,0] and no events fired (the "dud combo" issue above).
Lookahead-vs-random also currently wins 0/6 because there's nothing to
score. This is the known starting point — see `docs/04-next-steps.md`
for how to get a non-dud combo running first.

## A note on scale

The user's eventual vision is a 400x254 world with ~1000 rules. This
prototype runs on an 8x12 grid with 9 rules. That gap is intentional — see
`docs/04-next-steps.md` for the suggested scaling path (bigger grids and
more atoms are mostly "just add more", but the *generator* and *judge* need
to exist before scale is useful, otherwise you just get more noise faster).
