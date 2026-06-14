# 00 — The Board Game Era (previous phase)

Before this ECS prototype, the project built a complete pipeline for
*board games* (single-cell pieces, turn-based, grid of squares). This
document summarizes what was built, in case any of it is reusable.

## What existed

1. **A generator/judge for chess-like games** (`gamegen.py`, Python).
   - DNA: board size (6-9), optional wrap-around edges, mirrored walls,
     1-2 piece types defined by jump/slide vectors (optionally with
     separate "capture vectors", the chess-pawn trick), mirrored setup.
   - Win condition was FIXED: capture the enemy "royal" piece (1-square
     king-like mover). Draw at a move limit.
   - Judge simulated ~100 games per candidate with a greedy 1-ply AI vs
     itself and vs random, scoring: fairness (P1 vs P2 win rate), draw
     rate, "skill beats luck" (greedy vs random win rate), and average
     game length. Combined into a `fitness` score.
   - An evolutionary loop mutated the best candidates (tweak a vector,
     move a wall, toggle wrap) and re-judged.

2. **A harvest of 100 games + Chess** (`games100.json`), with Chess
   hand-encoded in the same JSON format as "Specimen #0" (the known
   benchmark).

3. **A playable web app ("The Gauntlet")**: 101 specimens, click-to-play,
   an opponent called "WARDEN" (minimax + alpha-beta + iterative deepening
   with a time budget), score tracking ("X/100 beaten"). Single HTML file,
   mobile-first, no dependencies. A real bug was found and fixed here:
   WARDEN's search could be interrupted mid-think by its time budget,
   corrupting the board state via incomplete undo -- fixed with
   try/finally around make/unmake and a board-integrity checker used in
   testing (every piece's position must match the occupancy grid; turn
   must alternate). That integrity-checking technique is directly
   applicable to this ECS prototype -- see 02-known-issues.md.

4. **A training pipeline** (`trainer/` zip): rules.py (universal rules
   interpreter reading the JSON DNA into numpy boards), net_mcts.py
   (ResNet policy/value net + batched MCTS self-play), baseline.py
   (the fixed minimax opponent as a progress yardstick), train.py
   (AlphaZero-style loop with checkpoint/resume), factory.py (the
   generator at scale, parallelized across CPU cores).

5. **An open-substrate variant** ("Specimen Lab II"): removed the
   royal-capture win condition, generated goals instead (annihilate /
   reach-far-row / collect-orbs / form-a-line), added black "orb" and
   "block" objects. Still single-cell pieces on a grid.

6. **"Korin Drift"**: a single hand-tuned game with a one-touch mechanic
   (tap a piece, it slides until it hits something, sweeps orbs, rotates
   one notch clockwise after landing). The board layout itself was chosen
   by simulating 400 candidate layouts and picking the best by the same
   fairness/decisiveness/skill judge.

## What's reusable here

- **The judge's three core metrics** (fairness, decisiveness, skill-beats-
  luck) are goal-agnostic in spirit and map directly onto the new ECS
  Judge's "Decisiveness" and "Skill Variance" metrics in
  03-original-ecs-spec.md. The formulas will need adapting (no more
  "P1/P2 win rate" in a free-for-all sense, but "score[0] vs score[1]
  trend" works the same way).

- **The integrity-checker testing pattern** (assert grid <-> entity
  consistency after every mutation) is exactly what would have caught
  the lineClear entity explosion earlier and faster. Recommend writing
  this as a real assertion function in the ECS test suite, not just an
  ad-hoc debug script.

- **The evolutionary loop shape** (random candidates -> judge -> keep top
  N -> mutate -> re-judge -> repeat, with periodic checkpointing to survive
  crashes) is the template for the eventual ECS-combo generator.

## What's NOT reusable / intentionally left behind

- The royal-capture win condition and anything chess-specific.
- The single-cell-piece assumption throughout gamegen.py's move
  generation -- the ECS's multi-cell Shape component supersedes it.
- The trainer's rules.py board encoding (int8 grid of piece codes) is
  too simple for multi-cell entities; the ECS's flat component arrays are
  the replacement, but the *training loop* (train.py's self-play +
  ResNet + checkpoint/resume structure) is still a reasonable template for
  whenever an ECS combo is good enough to train a neural net on.
