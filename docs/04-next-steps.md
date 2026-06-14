# 04 - Next steps, in suggested order

This is a concrete, ordered task list. Each task is scoped to be doable
and testable independently. Earlier tasks unblock later ones.

## 1. Add assertWorldValid() and a basic test runner

Before touching atoms again, write `tests/assert.js` (or similar) exporting
a function:

```js
function assertWorldValid(w, label) {
  // every alive entity's painted cells match w.grid
  // no two alive entities claim the same grid cell
  // w.alive.length (or count of alive===1) under some bound, e.g. 200
  // throw new Error(`${label}: ...`) on any violation
}
```

Use it in tests/demo.js after every step() call, at least in a "torture"
test that runs 200+ ticks with an agent that always picks the action most
likely to stress the atoms under test (e.g. always 'shoot').

This is cheap (an hour or two) and will make every subsequent task safer
and faster to debug.

## 2. Fix the "dud combo" (Issue 2)

Add a moveVertical input atom (up/down for PLAYER entities, same
propose-and-verify pattern as left/right in playerInput). Re-run
tests/demo.js. Confirm:
- `unique event types fired` is non-empty (expect at least `collision`,
  possibly `shoot_request`, `pickup`-related events)
- score is non-zero in at least some of the 6 random-vs-random-equivalent
  matches

This gives you the first NON-DUD combo, which is needed for task 4.

## 3. Fix lineClear (Issue 1), in isolation

Pick Option A from 02-known-issues.md (decompose locked multi-cell pieces
into 1x1 FALLER entities immediately on lock). Test this WITHOUT any
combat atoms -- just gravity + applyVelocity + lineClear + lock atoms +
a spawner, i.e. "pure Tetris, no players". Use assertWorldValid in a
200+ tick torture test (spawner keeps producing pieces; no player input
needed, pieces just fall straight down) before declaring this fixed.

Only after this passes should lineClear be combined with the
combat/player atoms from task 2.

## 4. Write judge_combo(world_builder, atomIds) -> verdict

This is the most important task -- it's the bridge from "hand-picked combo"
to "generator can search for combos automatically". Implement the metrics
table from 03-original-ecs-spec.md, adapted to this prototype's scale:

```js
function judgeCombo(buildWorldFn, atomIds, opts = {}) {
  // run several matches: lookaheadAgent vs randomAgent (both sides),
  // randomAgent vs randomAgent
  // compute:
  //   decisive: was there a winner (not a draw-by-timeout) in most matches?
  //   ruleDensity: how many distinct atom-driven event types fired,
  //                averaged across matches
  //   skillVariance: lookahead win rate vs random (both sides averaged)
  //   entityCountStable: did assertWorldValid hold throughout? (catches
  //                       Issue-1-style explosions automatically)
  // return { decisive, ruleDensity, skillVariance, entityCountStable,
  //          verdict: 'KEEPER' | 'DISCARD', reason: '...' }
}
```

Calibrate the thresholds empirically: run it on (a) the fixed combo from
task 2, and (b) a deliberately bad combo (e.g. just ['playerInput'] with
no other atoms -- nothing can ever happen) and (c) a deliberately explosive
combo (the original lineClear combo from Issue 1, BEFORE fixing it, but
with a low tick limit and try/catch so it doesn't OOM the test runner --
useful as a "does the judge correctly flag this as broken" test).

## 5. Build the atom library toward ~20-30

With judgeCombo() in place, new atoms can be added and immediately checked
for whether they produce interesting combos, rather than hand-debugged in
isolation. Candidates (from the original "1000 rules from gaming history"
ambition, scoped down): knockback-on-collision, timed hazards (a HAZARD
entity that damages on overlap, possibly moving in a fixed pattern),
multiple PICKUP types with different score values, a "respawn" atom
(dead PLAYER reappears after N ticks at a starting position), simple
line-of-sight (an atom that prevents shoot_request if a wall/entity is
between shooter and... well, shooting is directional here, so this might
be "can't shoot if immediately blocked", simpler than true LOS),
score-based win conditions beyond "first to X" (e.g. "most score when the
other side is eliminated").

For each new atom: write it, add it to ONE combo with existing atoms, run
judgeCombo + assertWorldValid torture test, before adding to the general
pool.

## 6. The Generator: combo search

Once judgeCombo() exists and there are ~20-30 atoms, port the evolutionary
search pattern from the board-game era (00-board-game-era.md): randomly
sample subsets of atoms (with some atoms always-included as "physics"
basics like applyVelocity), judge each, keep the best, mutate (swap one
atom in/out), repeat. This is directly analogous to gamegen.py's
random_spec/mutate/judge loop, just operating on sets of atom IDs instead
of piece-vector DNA.

Important: many random subsets will be NONSENSE (e.g. damageOnCollision
with no PROJECTILE-spawning atom present -- dead code). The generator
should probably have a small dependency table (e.g. damageOnCollision
"wants" shoot or some other projectile-spawner present) to avoid wasting
judge calls on obviously-incomplete combos -- though judgeCombo() itself
should also correctly DISCARD these via ruleDensity/decisiveness, so this
is an optimization, not a correctness requirement.

## 7. (Later) Scale up: bigger grid, more entities, rendering

Only after 1-6 produce at least one genuinely interesting combo: consider
(a) increasing W/H beyond 8x12 -- check assertWorldValid and cloneWorld
performance scale roughly linearly; (b) a minimal renderer (canvas/HTML,
following the pattern of the board-game era's GUIs -- see
00-board-game-era.md item 3 for the visual style/testing approach used
there); (c) the "1000 rules" ambition -- by this point you'll have a much
better sense of which atom CATEGORIES (movement, combat, hazards, scoring,
spawning) are productive, which informs how to prioritize mining more
atoms from gaming history rather than generating them uniformly at random.

## Things NOT to do yet

- Don't jump to C++ / the original spec's exact data structures until the
  JS prototype has at least one judged-KEEPER combo. Porting a design that
  hasn't been validated wastes the speed of JS iteration.
- Don't expand to 400x254 or attempt continuous (non-grid) movement. The
  grid-based propose-and-verify pattern is doing real work; continuous
  collision is a much bigger change best deferred until the rule-atom
  layer itself is proven.
- Don't try to implement the full ActionPacket-as-data format from
  03-original-ecs-spec.md unless task 6 (the Generator) specifically needs
  to synthesize NEW atoms rather than recombine existing ones. It's
  extra complexity that the current code-based atoms don't need yet.
