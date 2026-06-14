# Instructions for Claude Code

Read README.md first, then docs/ in numeric order (00 through 04).
docs/04-next-steps.md is an ordered task list -- start at task 1 unless
told otherwise.

Quick facts:
- No build step, no dependencies. `node tests/demo.js` runs everything.
- src/engine.js is the only library file; tests/demo.js is both the demo
  and (currently) the only test.
- Before adding/changing atoms, read docs/02-known-issues.md -- it
  documents a real bug (entity explosion) and the testing pattern that
  should have caught it sooner (docs/02, "Testing recommendations").
- The project's "Judge" (automated good/bad verdicts on rule combos) does
  NOT exist yet -- see docs/04-next-steps.md task 4. This is the highest-
  leverage thing to build.
- Style: plain JS, flat-array ECS, no classes, no external deps. Keep it
  that way unless a task explicitly calls for a dependency.
