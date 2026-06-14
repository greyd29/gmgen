# 03 - Original ECS architecture spec (source of truth for intent)

The user provided this C++ architecture document as the target design.
src/engine.js is a JS prototype that follows it loosely at a smaller scale.
This file is preserved verbatim (as plain text/markdown, code blocks kept
as illustrative C++) so future work can check the JS implementation against
the original intent and decide what to port more faithfully.

---

## System topology (from the original doc)

Three layers: GENERATOR (DNA pool of atomic rule JSONs + recombination),
SIMULATION SANDBOX (ECS: flat arrays for Position/Shape/Health, Systems for
Movement/Collision/Projectiles/Ticking, an event pipeline broadcasting
on_collision/on_tick), and SELF-PLAY JUDGE (MCTS/Greedy agent + heuristics
for decisiveness, skill-vs-luck, emergence).

Mapping to this repo:
- GENERATOR: NOT YET BUILT. Currently atoms are hand-picked into one COMBO
  array in tests/demo.js.
- SIMULATION SANDBOX: src/engine.js. The "Systems" are the ATOMS; the "flat
  arrays" are the component arrays on the world object; the "event
  pipeline" is ctx.events + the bounded processing rounds in step().
- SELF-PLAY JUDGE: NOT YET BUILT as automated verdicts. lookaheadAgent and
  randomAgent exist as the "agents"; the metrics table below is not yet
  code.

## Core data structures (from the original doc)

The original proposes:
- GridCell { entity_id, cell_type } in a flat global_grid vector.
- Position { x, y }; Velocity { dx, dy, tick_rate, tick_counter }; Shape
  { local_cells: [Position], orientation }; Health { hp, max_hp }; Metadata
  { tags: bitmask }.

Mapping to this repo:
- global_grid -> w.grid (Int32Array, cell -> entity id, -1 = empty). No
  separate cell_type yet (walls aren't modeled as a distinct cell type;
  there's no wall/hazard cell-type system implemented).
- Position -> w.x[id], w.y[id]
- Velocity -> w.vx[id], w.vy[id], w.tickRate[id], w.tickCtr[id] (tick_rate/
  tick_counter exist but aren't exercised by the current demo combo)
- Shape -> w.cells[id] (local offsets). No explicit `orientation` field --
  rotation is implemented by directly rotating the offsets 90 degrees
  (see playerInput's 'rotate' branch), so orientation is implicit in the
  cells array itself, not tracked separately.
- Health -> w.hp[id]
- Metadata.tags -> w.tags[id] (TAG bitmask)

Additional fields in this repo not in the original spec: w.alive[id]
(for slot recycling), w.locked[id] (added during development to fix the
faller-relock-spam issue, see 02-known-issues.md), w.side[id] (which
"player"/team an entity belongs to -- needed because the original spec's
score/Health model didn't specify team ownership explicitly).

## Atomic rule pipeline (from the original doc)

```cpp
enum class TriggerType { OnTick, OnCollision, OnInput, OnDestroy };

struct ActionPacket {
    std::string type;       // "shift_position", "damage", "spawn_entity"
    std::string target;     // "self", "other", "world"
    int magnitude;
    std::string value_str;
};

struct AtomicRule {
    std::string atom_id;
    TriggerType trigger;
    uint64_t primary_tag_filter;
    uint64_t secondary_tag_filter;
    std::vector<ActionPacket> actions;
};
```

Mapping to this repo: each entry in ATOMS is roughly one AtomicRule, but
`filter` and `apply` are JS functions/closures rather than declarative
tag-bitmask + ActionPacket-list data. This is a SIGNIFICANT divergence: the
original spec implies atoms are pure DATA (so a generator could construct
new atoms by recombining trigger+filter+action JSON without writing code).
The current prototype's atoms are CODE. If the eventual Generator needs to
synthesize genuinely new atoms (not just new COMBINATIONS of the existing
9), the ActionPacket-style declarative format from the original spec should
be implemented -- see 04-next-steps.md for how this might be staged.

For now, the Generator's job (recombining EXISTING atoms into different
COMBO arrays) doesn't require this -- the current code-based atoms are
already individually selectable/combinable, which is the more limited but
much-easier-to-implement form of "recombination."

## Unified game loop (from the original doc)

```
[START TICK]
 1. GATHER INPUT     -> Query Generic Agent
 2. APPLY VELOCITY   -> Progress gravity/projectiles, defer conflicts to
                         collision event queue
 3. PROCESS EVENTS   -> Evaluate OnCollision/OnTick rules; apply damage,
                         clear rows, modify health
 4. GRID REBREADING  -> Sync flat components back into global_grid
[END TICK]
```

Mapping to this repo: step()'s 5 phases (input, per-entity tick atoms,
event processing x4, global tick atoms, event processing x2) are a more
granular version of this. "GRID REBREADING" (phase 4 in the original) is
handled continuously via paintEntity/unpaintEntity inside applyVelocity
and other mutators, rather than as a separate end-of-tick sync pass --
this repo's grid is always kept in sync immediately, not batched.

## Multi-cell rotation and collision: Propose-and-Verify (from the original doc)

> 1. Calculate temporary target positions of all cells in the Shape.
> 2. Check global_grid at those target coordinates.
> 3. If any target cell mismatches or is a solid wall, block the movement
>    and queue an OnCollision event with both entities. Otherwise commit.

This is implemented faithfully in applyVelocity (for movement) and in
playerInput's left/right/rotate handlers (for player-controlled multi-cell
shapes) -- both compute `proposed` cell lists and check w.grid before
committing.

## The General Agent & Judge interface (from the original doc)

```cpp
class GameSimulation {
public:
    void configure(const std::vector<AtomicRule>& rules);
    GameSimulation clone() const;
    void step(ActionInput input);
    int get_score() const;
    bool is_game_over() const;
    const std::vector<GridCell>& get_grid() const;
};

ActionInput get_best_action(const GameSimulation& current_state) {
    // for each of {Left, Right, Rotate, Shoot, Wait}:
    //   clone, simulate forward N ticks, evaluate_state(), pick best
}
```

Mapping to this repo: lookaheadAgent(w, rules, side, depth) implements
get_best_action almost exactly -- clone, simulate `depth` ticks (first tick
= candidate input, rest = 'wait'), evaluate(), pick best. evaluate() is the
prototype's evaluate_state(). is_game_over() is NOT a function yet -- the
demo harness's runMatch() inlines an end condition (score threshold or a
player having zero alive entities of TAG.PLAYER).

## The Judge's metric table (from the original doc)

| Metric | Target | Formula / Check |
|---|---|---|
| Decisiveness | game shouldn't last forever or end instantly | 100 < total_ticks < 5000 |
| Rule Density | multiple rules interacting, not just one | count unique atom_id executions in the run log; target > 3 |
| Skill Variance | lookahead agent should beat random | score_agent - score_random > threshold |

Mapping to this repo: NONE OF THIS IS IMPLEMENTED AS CODE YET. The demo
harness prints some raw numbers (ended tick, score, unique event types,
lookahead win rate) that are the RAW INGREDIENTS for these metrics, but
there's no judge_combo(comboAtoms) function that returns a verdict. This
is the most important missing piece for turning "a hand-picked combo" into
"a generator that finds good combos automatically" -- see 04-next-steps.md.

Note: the original doc's ticks-based thresholds (100 < ticks < 5000) were
written for a presumably larger/slower-paced simulation than the current
8x12, ~9-atom prototype, where matches end in well under 150 ticks. These
numbers will need recalibrating empirically once a few combos actually
produce decisive games.

## "Why this structure will move fast" (from the original doc)

- Zero allocations in the hot loop / cloning via memcpy: the JS prototype
  does NOT achieve this -- cloneWorld() does .slice() on several arrays
  and a nested .map() for w.cells, which allocates. At ~1ms/clone with
  ~15-60 entities this is fine for now, but if scaling to 1000s of self-
  play games/sec or much larger entity counts, this is the first place to
  optimize (e.g. typed arrays for x/y/vx/vy/hp/tags/side/locked -- already
  partially true via Int32Array for grid, but the component arrays are
  plain JS arrays).
- Trivial extension to rendering (Raylib or similar): not attempted in
  this repo. Everything is headless/console. w.grid and the component
  arrays are exactly what a renderer would loop over, per the original
  doc's suggestion.
