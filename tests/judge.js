const { TAG, ATOMS, makeWorld, addEntity, buildRules, cloneWorld, step, evaluate, lookaheadAgent, randomAgent } = require('../src/engine');
const { assertWorldValid } = require('./assert');

function runMatch(buildWorldFn, atomIds, maxTicks, agents){
  const {w, rules} = buildWorldFn(atomIds);
  const log = [];
  for (let t = 0; t < maxTicks; t++){
    const inputs = {};
    for (let id = 0; id < w.alive.length; id++){
      if (!w.alive[id] || !(w.tags[id] & TAG.PLAYER)) continue;
      const side = w.side[id];
      inputs[id] = agents[side](w, rules, side);
    }
    const tickEvents = [];
    for (const id in inputs){
      const ctx = {events: []};
      for (const a of rules.input) if (a.filter(w, +id)) a.apply(w, +id, {...ctx, input: inputs[id]});
      tickEvents.push(...ctx.events.map(e => e.type));
    }
    const ctx = {events: []};
    for (const a of rules.tick.filter(a => !a.global)){
      for (let id = 0; id < w.alive.length; id++){
        if (w.alive[id] && a.filter(w, id)) a.apply(w, id, ctx);
      }
    }
    for (let round = 0; round < 4 && ctx.events.length; round++){
      const batch = ctx.events; ctx.events = [];
      tickEvents.push(...batch.map(e => e.type));
      for (const ev of batch) for (const a of rules.event) if (a.match === ev.type) a.apply(w, ev, ctx);
    }
    for (const a of rules.tick.filter(a => a.global)) a.apply(w, null, ctx);
    for (let round = 0; round < 2 && ctx.events.length; round++){
      const batch = ctx.events; ctx.events = [];
      tickEvents.push(...batch.map(e => e.type));
      for (const ev of batch) for (const a of rules.event) if (a.match === ev.type) a.apply(w, ev, ctx);
    }
    w.tick++;
    assertWorldValid(w, `tick ${t}`);
    if (w.over){
      const winner = w.winner ?? null;
      return {w, rules, log, ended: t, winner, p0: true, p1: true};
    }
    const atoms = tickEvents;
    log.push({tick: t, score: w.score.slice(), atoms});

    let p0 = false, p1 = false;
    for (let id = 0; id < w.alive.length; id++){
      if (!w.alive[id] || !(w.tags[id] & TAG.PLAYER)) continue;
      if (w.side[id] === 0) p0 = true;
      if (w.side[id] === 1) p1 = true;
    }
    if (!p0 || !p1) {
      const winner = !p0 ? 1 : !p1 ? 0 : null;
      return {w, rules, log, ended: t, winner, p0, p1};
    }
  }
  const winner = w.score[0] > w.score[1] ? 0 : w.score[1] > w.score[0] ? 1 : null;
  return {w, rules, log, ended: maxTicks, winner, p0: true, p1: true};
}

function buildDemoWorld(atomIds){
  const W = 8, H = 12;
  const w = makeWorld(W, H);
  const rules = buildRules(atomIds);
  addEntity(w,{x:3,y:H-1,cells:[[0,0]],hp:5,tags:TAG.PLAYER,side:0});
  addEntity(w,{x:3,y:0,cells:[[0,0]],hp:5,tags:TAG.PLAYER,side:1});
  addEntity(w,{x:4,y:H-2,cells:[[0,0]],tags:TAG.PICKUP});
  addEntity(w,{x:2,y:3,cells:[[0,0]],tags:TAG.PICKUP});
  addEntity(w,{x:1,y:0,cells:[[0,0]],tags:TAG.FALLER});
  return {w, rules};
}

function judgeCombo(buildWorldFn, atomIds, opts = {}){
  const randomMatchCount = opts.randomMatches ?? 6;
  const lookaheadMatchCount = opts.lookaheadMatches ?? 6;
  const maxTicks = opts.maxTicks ?? 150;
  const decisiveMatches = [];
  const ruleDensityValues = [];
  const lookaheadWins = [];
  let entityCountStable = true;

  const captureMatch = (res) => {
    const eventTypes = new Set(res.log.flatMap(step => step.atoms));
    const uniqueEvents = eventTypes.size;
    ruleDensityValues.push(uniqueEvents);
    const decisive = res.ended < maxTicks && res.winner !== null;
    decisiveMatches.push(decisive);
    return {uniqueEvents, decisive};
  };

  for (let i = 0; i < randomMatchCount; i++){
    try {
      const res = runMatch(buildWorldFn, atomIds, maxTicks, [randomAgent, randomAgent]);
      captureMatch(res);
    } catch (err){
      entityCountStable = false;
    }
  }

  for (let i = 0; i < lookaheadMatchCount; i++){
    const depth = opts.lookaheadDepth ?? 2;
    const agents = i % 2 === 0
      ? [(w, rules, s) => lookaheadAgent(w, rules, s, depth), randomAgent]
      : [randomAgent, (w, rules, s) => lookaheadAgent(w, rules, s, depth)];
    try {
      const res = runMatch(buildWorldFn, atomIds, maxTicks, agents);
      const winner = res.winner;
      const lookaheadSide = i % 2 === 0 ? 0 : 1;
      const win = winner === lookaheadSide ? 1 : 0;
      lookaheadWins.push(win);
      captureMatch(res);
    } catch (err){
      entityCountStable = false;
      lookaheadWins.push(0);
    }
  }

  const decisiveRate = decisiveMatches.filter(Boolean).length / decisiveMatches.length;
  const ruleDensity = ruleDensityValues.reduce((sum, v) => sum + v, 0) / ruleDensityValues.length;
  const skillVariance = lookaheadWins.reduce((sum, v) => sum + v, 0) / lookaheadWins.length;
  const verdict = entityCountStable && decisiveRate >= 0.3 && ruleDensity >= 1.5 && skillVariance >= 0.5
    ? 'KEEPER' : 'DISCARD';
  const reason = [];
  if (!entityCountStable) reason.push('unstable entity counts or invalid world');
  if (decisiveRate < 0.3) reason.push(`low decisiveness (${(decisiveRate*100).toFixed(0)}%)`);
  if (ruleDensity < 1.5) reason.push(`low rule density (${ruleDensity.toFixed(2)})`);
  if (skillVariance < 0.5) reason.push(`low skill variance (${(skillVariance*100).toFixed(0)}%)`);
  if (reason.length === 0) reason.push('meets minimum judge thresholds');

  return {
    atomIds,
    decisiveRate,
    ruleDensity,
    skillVariance,
    entityCountStable,
    verdict,
    reason: reason.join('; '),
  };
}

// All available atoms and the physics core that must always be present.
const ALL_ATOMS = Object.keys(ATOMS);
const PHYSICS_CORE = ['gravity', 'applyVelocity', 'playerInput', 'moveVertical'];

function mutateCombo(combo, allAtoms, core = []){
  let next = combo.slice();
  // only remove atoms that are not in the core
  const removable = next.filter(id => !core.includes(id));
  if (removable.length > 0 && Math.random() < 0.4){
    const target = removable[(Math.random()*removable.length)|0];
    next.splice(next.indexOf(target), 1);
  }
  if (Math.random() < 0.8){
    const options = allAtoms.filter(id => !next.includes(id));
    if (options.length) next.push(options[(Math.random()*options.length)|0]);
  }
  // guarantee core atoms are always present
  for (const id of core) if (!next.includes(id)) next.push(id);
  return Array.from(new Set(next));
}

function comboScore(res){
  if (!res.entityCountStable) return -1000;
  return res.decisiveRate * 100 + res.skillVariance * 40 + res.ruleDensity * 10;
}

function searchCombos(seedCombo, allAtoms, core = [], rounds = 50, opts = {}){
  // Use lighter settings for search by default: fewer matches, shallower lookahead.
  // Caller can override any of these.
  const searchOpts = {randomMatches: 4, lookaheadMatches: 2, maxTicks: 80, lookaheadDepth: 1, ...opts};
  console.log(`\nCombo search: ${allAtoms.length} atoms in pool, ${rounds} rounds`);
  console.log(`Core: [${core.join(', ')}]\n`);

  const seedResult = judgeCombo(buildDemoWorld, seedCombo, searchOpts);
  let best = {combo: seedCombo.slice(), result: seedResult, score: comboScore(seedResult)};
  console.log(`Seed  | ${best.result.verdict} | score=${best.score.toFixed(1)} | atoms=${best.combo.length} | ${best.result.reason}`);

  for (let i = 0; i < rounds; i++){
    const candidate = mutateCombo(best.combo, allAtoms, core);
    const result = judgeCombo(buildDemoWorld, candidate, searchOpts);
    const score = comboScore(result);
    const improved = score > best.score;
    if (improved) best = {combo: candidate, result, score};
    if ((i + 1) % 5 === 0 || improved){
      const tag = improved ? '  << new best' : '';
      console.log(`R${String(i+1).padStart(3)} | ${result.verdict} | score=${score.toFixed(1)} | atoms=${candidate.length}${tag}`);
    }
  }

  console.log('\n=== Best combo found ===');
  console.log('Atoms :', best.combo.sort().join(', '));
  console.log('Score :', best.score.toFixed(1));
  console.log('Judge :', JSON.stringify({
    decisiveRate: best.result.decisiveRate,
    ruleDensity: +best.result.ruleDensity.toFixed(2),
    skillVariance: best.result.skillVariance,
    entityCountStable: best.result.entityCountStable,
    verdict: best.result.verdict,
    reason: best.result.reason,
  }, null, 2));
  return best;
}

if (require.main === module){
  const SEED_COMBO = ['gravity','applyVelocity','lineClear','playerInput','moveVertical','shoot','damageOnCollision','lockOnHitWall','lockOnCollisionFaller','destroyProjectileOnWall','pickupOnCollision','healOnPickup','pickupSpawner','hazardSpawner','movingHazard','hazardDamage','spawnNextFaller','enemySpawner','enemyMove','enemyContactDamage','scoreThresholdWin'];
  searchCombos(SEED_COMBO, ALL_ATOMS, PHYSICS_CORE, 50);
}

module.exports = { runMatch, judgeCombo, buildDemoWorld, searchCombos, ALL_ATOMS, PHYSICS_CORE };
