# 02 - Known issues (read before continuing)

## Issue 1: lineClear + faller-locking causes an entity explosion

### Symptom
With the combo ['gravity','applyVelocity','lineClear','playerInput','shoot',
'damageOnCollision','lockOnHitWall','lockOnCollisionFaller','pickupOnCollision'],
running step() repeatedly: entity count goes 61 -> 960 between roughly tick 60
and tick 86, then OOMs.

### Root cause (best understanding so far)
lineClear's implementation, when it finds a full row at y, removes just that
row's cells from each FALLER's cells array (cell-by-cell), rather than
treating the whole multi-cell piece as a unit. This can leave a
different-shaped remnant entity (e.g. an L-piece becomes a single floating
cell after its bottom row clears). That remnant still has locked=1, so
gravity skips it -- but the subsequent full-grid repaint can create new full
rows in ways that re-trigger spawn_next_faller for entities that were
already locked, across multiple step() calls. The bounded event-processing
rounds (4, then 2) reset every step() call, so a slow per-tick leak isn't
bounded by them.

### Recommended fix approach
Don't do cell-by-cell removal on multi-cell entities. Two options:

- Option A (simplest, "Tetris-correct"): once a multi-cell piece locks,
  immediately decompose it into N separate 1x1 FALLER entities, each
  already locked=1. Then lineClear's cell-by-cell removal is naturally
  correct -- each grid cell IS one entity.

- Option B (closer to real Tetris): keep multi-cell locked pieces, but on
  line-clear only fully killEntity() pieces whose ENTIRE shape is in
  cleared rows; for pieces with SOME cells cleared, recompute their shape
  and re-evaluate whether they should unlock. More correct visually, more
  code and edge cases.

Either way: add a hard assertion (see Testing recommendations below) that
catches entity-count growth immediately in a unit test.

### Status
EXCLUDED from tests/demo.js's COMBO. The atom still exists in
src/engine.js (ATOMS.lineClear) but nothing references it.

---

## Issue 2: the demo combo is a "dud" (0 events in 150 ticks of random play)

### Symptom
node tests/demo.js -> random vs random ends at the tick limit, score [0,0],
"unique event types fired: []".

### Root cause
Two compounding design issues in tests/demo.js's buildWorld():

1. Players can only left, right, rotate, shoot, or wait. There is NO
   vertical movement atom for players, so a player can never walk onto a
   pickup placed at a different row.
2. Pickups are placed at (4, H-2) and (2, 3) -- neither is in either
   player's row (y=H-1 and y=0), and players can't change row.
3. Shooting CAN work (verified separately with a scripted test: HP ticked
   5->3 over 14 ticks when player 0 shot every other tick with both
   players in the same column) -- but with rotate/left/right moving the
   shooter out of the projectile's column before it travels far enough,
   random play essentially never lines up a hit in 100-150 ticks.

### This is not really a "bug" -- it's the Judge working as intended
A combo where random play produces zero events is exactly what should get
a DISCARD verdict once the Judge exists. Right now there's no Judge, so it
just produces an unhelpful demo silently.

### Recommended fix (good first tasks)
- (a) Add a moveVertical input atom (up/down, same proposal/verify logic as
  left/right) so players can reach pickups.
- (b) Reposition the two PICKUPs to be reachable given the current
  left/right/rotate/shoot-only input set. More of a band-aid.
- (c) Do both, then re-run demo.js and confirm "unique event types fired"
  includes collision, shoot_request, and ideally a nonzero score.

---

## Testing recommendations (apply BEFORE adding more atoms)

1. Conservation/integrity assertion, run after every step() in tests:
   "every alive entity's cells, when painted, exactly match grid[]", "no
   two alive entities claim the same grid cell", "w.alive.length stays
   under some sane bound (e.g. 200) over N ticks". Write this as a real
   function (assertWorldValid(w)), not an ad-hoc console.log script.

2. Torture test with extreme inputs: an agent that ALWAYS shoots, or
   ALWAYS does the action most likely to trigger the atom under test --
   run for many ticks and check assertWorldValid. This is how Issue 1 was
   found.

3. One atom at a time before combos: test gravity + applyVelocity +
   lockOnHitWall + lockOnCollisionFaller alone (a single FALLER piece falls
   and locks correctly) before adding lineClear on top.
