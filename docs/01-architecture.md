# 01 - Architecture: how the ECS engine works

This describes src/engine.js as it currently exists. It's a simplified
JS translation of 03-original-ecs-spec.md (the C++ design doc the user
provided) -- same concepts, smaller scale.

## The World

makeWorld(W, H) returns a plain object:

```js
{
  W, H,
  grid: Int32Array(W*H),   // cell index -> entity id, or -1 if empty
  // component arrays, parallel, indexed by entity id:
  alive, x, y, cells,      // cells = [[dx,dy], ...] local offsets (the "Shape")
  vx, vy, tickRate, tickCtr, locked,
  hp, tags, side,
  score: [0, 0],           // per-side score
  tick, log, over, winner,
}
```

There is no class hierarchy. An "entity" is just an integer index into all
of these arrays. addEntity() recycles dead slots (where alive[i]===0)
so long-running simulations with lots of spawning/dying don't grow memory
unboundedly.

## Shapes (multi-cell entities)

cells[id] is a list of [dx, dy] local offsets from (x[id], y[id]).
A 1x1 entity has cells = [[0,0]]. A Tetris L-piece might have
cells = [[0,0],[0,1],[1,1]]. cellsOf(w, id) returns the *absolute*
cell positions. paintEntity/unpaintEntity keep grid[] in sync with
where each entity's cells currently are -- every function that moves an
entity must call unpaint -> mutate position/cells -> paint, or grid[]
and the component arrays will disagree (this is the #1 source of bugs;
see 02-known-issues.md).

## Tags

tags[id] is a bitmask (TAG.PLAYER, TAG.PROJECTILE, etc, see top of
engine.js). Atoms use tags to decide what they apply to. This is the
"Filter" from the original spec.

## Atoms

Each atom in ATOMS is { id, on, filter, apply, global?, match? }:

- on: 'tick' -- runs once per entity per tick, if filter(w, id) is true.
  global: true atoms (currently only lineClear) run once per tick total,
  not per entity.
- on: 'input' -- runs once per entity per tick during the input phase,
  receives the chosen action via ctx.input.
- on: 'event' -- runs when an event of type `match` is queued by another
  atom (via ctx.events.push({type:..., ...})).

Atoms communicate ONLY through (a) mutating component arrays directly, or
(b) pushing events for other atoms to react to. There's no direct
atom-to-atom calling. This is what makes recombination possible in
principle: any subset of atoms can be active, and they only interact via
the shared world state + event bus.

## The tick loop (step(w, rules, input))

```
1. INPUT PHASE
   for each input atom, for each entity where filter() is true:
     apply(w, id, {input, events})

2. PER-ENTITY TICK ATOMS (non-global)
   for each tick atom (not global), for each entity where filter() is true:
     apply(w, id, ctx)
   -- this is where gravity sets vy=1, and applyVelocity proposes a move,
      checks the grid, and either commits it or queues a 'collision' or
      'hit_wall' event.

3. EVENT PROCESSING (up to 4 rounds)
   while there are queued events (bounded to 4 rounds):
     for each event, for each event-atom whose `match` equals event.type:
       apply(w, event, ctx)   -- may queue MORE events (e.g. collision ->
                                  damage -> death -> score change)

4. GLOBAL TICK ATOMS
   (currently just lineClear, EXCLUDED from the demo combo -- see below)

5. MORE EVENT PROCESSING (up to 2 rounds)
   -- catches events queued by global atoms (e.g. line-clear wanting to
      spawn the next falling piece)

w.tick++
```

The "bounded rounds" on event processing exist to prevent infinite event
cascades, but they are a band-aid, not a guarantee -- see
02-known-issues.md for what happened when this wasn't enough.

## The 9 current atoms

| Atom | Type | What it does |
|---|---|---|
| gravity | tick | If entity has TAG.FALLER and vy==0 and not locked, set vy=1 |
| applyVelocity | tick | Move entity by (vx,vy) if the destination is clear; else queue collision (entity-entity) or hit_wall (off-grid) |
| lineClear | tick, global | EXCLUDED -- see 02-known-issues.md |
| playerInput | input | PLAYER entities: left/right (shift x), rotate (rotate cells 90deg), shoot (queue shoot_request) |
| shoot | event (shoot_request) | Spawn a 1x1 PROJECTILE above the shooter, vy=-1 |
| damageOnCollision | event (collision) | If a PROJECTILE collided with something that has hp>0, reduce hp; if hp<=0, award score to the *other* side and kill it. Always kills the projectile. |
| lockOnHitWall | event (hit_wall) | If a FALLER hit a wall and isn't locked yet: set locked=1, vx=vy=0, queue spawn_next_faller |
| lockOnCollisionFaller | event (collision) | Same as above but for FALLER-vs-entity collisions |
| destroyProjectileOnWall | event (hit_wall) | PROJECTILE that hits a wall is removed (prevents it sitting at the edge forever) |
| pickupOnCollision | event (collision) | If a PLAYER collided with a PICKUP, award that side 3 points and remove the pickup |

## The lookahead agent

```js
lookaheadAgent(w, rules, side, depth=3)
```

For each of the 5 possible inputs (left, right, rotate, shoot, wait):
1. cloneWorld(w) -- a deep copy (flat arrays make this cheap, ~1ms even
   with ~15-60 live entities).
2. Apply that input on tick 0, then 'wait' for the remaining depth-1
   ticks.
3. evaluate(simWorld, side) -- currently:
   score[side]*10 - score[1-side]*10 + (sum of (hp+1) for my alive
   entities)*0.5 - (same for opponent)*0.5
4. Pick the input with the highest evaluation.

This is intentionally generic -- it doesn't know what the atoms *mean*,
only that score[] and hp[]/alive exist. This is the "Generic Agent"
from the original spec, simplified (no real MCTS tree yet, just 1-ply
lookahead with a short forward simulation per branch).

randomAgent picks uniformly from the 5 inputs.

## Differences from the original C++ spec (03-original-ecs-spec.md)

- No actual ECS "registry" object/class -- just a plain JS object with
  parallel arrays. Functionally equivalent for this scale.
- Velocity.tick_rate / tick_counter exist but are only exercised by
  FALLER entities currently (tickRate=3 in the old demo setup -- removed
  in the current buildWorld, see tests/demo.js).
- The spec's GameSimulation class (configure, clone, step, get_score,
  is_game_over, get_grid) maps to: buildRules() + makeWorld()/addEntity()
  (configure), cloneWorld() (clone), step() (step), w.score (get_score),
  checking w.alive[id] for PLAYER entities (is_game_over -- not yet
  implemented as a function, see 04-next-steps.md), w.grid (get_grid).
- The Judge's metrics table (Decisiveness / Rule Density / Skill Variance)
  is described but NOT YET CODE -- see 04-next-steps.md.
