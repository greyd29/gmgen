const { TAG, makeWorld, addEntity, buildRules, step } = require('../src/engine');
const { assertWorldValid } = require('./assert');

const W = 6, H = 6;
const rules = buildRules(['gravity','applyVelocity','lineClear','lockOnHitWall','lockOnCollisionFaller']);
const w = makeWorld(W, H);
addEntity(w, {x:0, y:5, cells:[[0,0]], tags: TAG.FALLER, side: 0});
addEntity(w, {x:1, y:5, cells:[[0,0]], tags: TAG.FALLER, side: 0});
addEntity(w, {x:2, y:5, cells:[[0,0]], tags: TAG.FALLER, side: 0});
addEntity(w, {x:3, y:5, cells:[[0,0]], tags: TAG.FALLER, side: 0});
addEntity(w, {x:4, y:5, cells:[[0,0]], tags: TAG.FALLER, side: 0});
addEntity(w, {x:5, y:5, cells:[[0,0]], tags: TAG.FALLER, side: 0});
addEntity(w, {x:2, y:0, cells:[[0,0],[1,0]], tags: TAG.FALLER, side: 0});

for (let t = 0; t < 100; t++) {
  step(w, rules, 'wait');
  assertWorldValid(w, `lineclear tick ${t}`);
  const alive = w.alive.reduce((sum, v) => sum + (v ? 1 : 0), 0);
  if (alive > 200) {
    throw new Error(`too many entities after tick ${t}: ${alive}`);
  }
}
console.log('lineclear_test passed');
