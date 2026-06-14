# Game Factory ECS

An experimental engine for generating tiny 2D games by recombining small rule
atoms.

The goal is not to hand-design one game. The goal is to build a system that can:

1. combine simple mechanics such as gravity, shooting, pickups, hazards, enemies,
   respawn, and line clearing;
2. simulate the result automatically;
3. let simple agents play it;
4. judge whether the result looks like a coherent game or just noise.

At the moment, this project is a working prototype. It can simulate rule combos,
run AI-vs-AI matches, visualize them in a browser, and score combinations with a
first-pass judge. It does not yet reliably generate good games.

## Current Verdict

The engine is useful. The latest generated game should probably be discarded.

The current sample combo mixes too many unrelated ideas:

- Tetris-like falling blocks and line clears
- arena shooting
- pickups and healing
- drifting hazards
- chasing enemies
- respawning players
- score-threshold wins

The simulation is active and decisive, but the rules do not cohere into a clear
player experience. A human can watch it and ask, reasonably, "what game am I
actually playing?"

That is the central lesson of the current prototype: the judge can detect
activity, decisiveness, and basic skill variance, but it does not yet understand
design coherence.

## What Works

- `src/engine.js` contains the ECS-style simulation core.
- Worlds are small grids with entities made of one or more cells.
- Components are stored in flat arrays indexed by entity id.
- Atoms define mechanics such as movement, gravity, shooting, collision damage,
  pickups, hazards, enemies, respawn, and line clearing.
- `cloneWorld()` supports cheap lookahead for simple AI agents.
- `tests/demo.js` runs a fixed sample match in Node.
- `tests/judge.js` mutates rule combinations and scores them.
- `tests/viewer.html` displays AI-vs-AI matches in a browser.
- `tests/lineclear_test.js` catches regressions around line clearing and entity
  stability.

## What Does Not Work Yet

- The generated games are not necessarily understandable or fun.
- The judge can mark a messy mechanics pile as `KEEPER` if it is decisive and
  produces enough events.
- There is no human-play mode yet; the viewer is currently a simulation viewer.
- The rule library is still tiny compared to the original long-term idea.
- The docs under `docs/` include older planning/history notes and may lag behind
  the current prototype.

## How To Run

Requires Node.js 18 or newer. There are no npm dependencies.

Run the console demo:

```bash
npm run demo
```

Run the browser viewer:

```bash
npm run viewer
```

Then open:

```text
http://localhost:3000/tests/viewer.html
```

You can also use Python's built-in server:

```bash
python -m http.server 3000
```

Then open the same URL above.

Run the judge/search:

```bash
node --max-old-space-size=4096 tests/judge.js
```

Run the line-clear regression test:

```bash
node tests/lineclear_test.js
```

## The Current Sample Game

The viewer currently shows an AI-vs-AI simulation on an 8 by 12 grid.

- Teal starts at the bottom.
- Red starts at the top.
- Blue fallers drop from above and can form clearable rows.
- Yellow projectiles are fired by players.
- Gold pickups heal.
- Orange hazards damage nearby players.
- Purple enemies chase players.
- Dead players can respawn.
- The first side to reach the score threshold wins.

By default this is not human-controlled. P0 is usually the lookahead agent, and
P1 is random. If P0 wins, that means the AI on the teal side won.

## The Judge

`tests/judge.js` currently scores combinations using simple metrics:

- decisiveness: does the match end?
- rule density: do events happen?
- skill variance: does lookahead beat random?
- stability: do entity counts and grid invariants remain sane?

These metrics are useful but incomplete. They can say "this simulation is alive"
but not "this is a good game."

The next important judge metric should be coherence. For example, a combo should
be penalized when it mixes too many independent systems without a dominant core
loop. A generated game should probably be one of these, not all at once:

- falling-block puzzle
- arena shooter
- pickup race
- survival chase

## Project Layout

```text
gamefactory-ecs/
  src/
    engine.js              ECS core, atoms, agents, simulation step
  tests/
    demo.js                Console demo
    judge.js               Combo mutation and first-pass judge
    viewer.html            Browser simulation viewer
    viewer_server.js       Tiny local HTTP server for the viewer
    lineclear_test.js      Regression test for line clearing
    assert.js              World invariant checks
  docs/
    00-board-game-era.md    Notes from the older board-game generator phase
    01-architecture.md      ECS architecture notes
    02-known-issues.md      Older issue notes; may be stale
    03-original-ecs-spec.md Original architecture/spec reference
    04-next-steps.md        Older next-step planning
```

## Suggested Next Steps

1. Add human controls to the viewer.
2. Add a plain-English rules panel for the active combo.
3. Add a coherence score to the judge.
4. Restrict generated combos to one dominant genre loop at a time.
5. Promote stable, understandable combos into named presets.
6. Update or archive stale docs once the current direction is clear.

## Philosophy

This project is not failing because it generated a bad game. It would fail only
if it could not learn to reject bad games.

The current prototype proves that the system can create simulations with moving
parts, scoring, agents, and endings. The next step is teaching it taste: not just
"did something happen?" but "does this deserve to exist as a game?"
