// ===================== node harness =====================
const {
  TAG, ATOMS, makeWorld, addEntity, cellsOf, paintEntity, unpaintEntity, killEntity,
  cloneWorld, buildRules, step, evaluate, lookaheadAgent, randomAgent, INPUTS,
} = require('../src/engine');
const { assertWorldValid } = require('./assert');

if (require.main === module){
  const W=8, H=12;

  function buildWorld(atomIds){
    const w = makeWorld(W,H);
    const rules = buildRules(atomIds);
    // PLAYER (side 0) bottom, can shoot upward
    addEntity(w,{x:3,y:H-1,cells:[[0,0]],hp:5,tags:TAG.PLAYER,side:0});
    // ENEMY (side 1) top, same column so projectiles can connect
    addEntity(w,{x:3,y:0,cells:[[0,0]],hp:5,tags:TAG.PLAYER,side:1});
    // a few PICKUPs
    addEntity(w,{x:4,y:H-2,cells:[[0,0]],tags:TAG.PICKUP});
    addEntity(w,{x:2,y:3,cells:[[0,0]],tags:TAG.PICKUP});
    // initial FALLER to bootstrap the Tetris-like piece flow
    addEntity(w,{x:1,y:0,cells:[[0,0]],tags:TAG.FALLER});
    return {w, rules};
  }

  function runMatch(atomIds, maxTicks, agents){
    const {w, rules} = buildWorld(atomIds);
    const log=[];
    for (let t=0;t<maxTicks;t++){
      const inputs = {};
      for (let id=0; id<w.alive.length; id++){
        if (!w.alive[id] || !(w.tags[id]&TAG.PLAYER)) continue;
        inputs[id] = agents[w.side[id]](w, rules, w.side[id]);
      }
      // apply each player's input as its own "input" phase, then shared tick/event
      const tickEvents=[];
      for (const id in inputs){
        const ctx={events:[]};
        for (const a of rules.input) if (a.filter(w,+id)) a.apply(w,+id,{...ctx, input:inputs[id]});
        tickEvents.push(...ctx.events.map(e=>e.type));
      }
      const ctx={events:[]};
      for (const a of rules.tick.filter(a=>!a.global))
        for (let id=0;id<w.alive.length;id++) if (w.alive[id]&&a.filter(w,id)) a.apply(w,id,ctx);
      for (let round=0; round<4 && ctx.events.length; round++){
        const batch=ctx.events; ctx.events=[];
        tickEvents.push(...batch.map(e=>e.type));
        for (const ev of batch) for (const a of rules.event) if (a.match===ev.type) a.apply(w,ev,ctx);
      }
      for (const a of rules.tick.filter(a=>a.global)) a.apply(w,null,ctx);
      for (let round=0; round<2 && ctx.events.length; round++){
        const batch=ctx.events; ctx.events=[];
        tickEvents.push(...batch.map(e=>e.type));
        for (const ev of batch) for (const a of rules.event) if (a.match===ev.type) a.apply(w,ev,ctx);
      }
      // validate world invariants after the micro-tick processing
      assertWorldValid(w, `tick ${t}`);
      w.tick++;
      log.push({tick:t, score:w.score.slice(),
        atoms: tickEvents});
      if (w.score[0]>=30 || w.score[1]>=30) return {w, log, ended:t};
      let p0=false,p1=false;
      for (let id=0;id<w.alive.length;id++) if (w.alive[id]&&(w.tags[id]&TAG.PLAYER)){
        if (w.side[id]===0) p0=true; if (w.side[id]===1) p1=true;
      }
      if (!p0 || !p1) return {w, log, ended:t};
    }
    return {w, log, ended:maxTicks};
  }

  // ---- combination: Tetris/fighter hybrid ----
  const COMBO = ['gravity','applyVelocity','lineClear','playerInput','moveVertical','shoot','damageOnCollision','lockOnHitWall','lockOnCollisionFaller','destroyProjectileOnWall','pickupOnCollision','healOnPickup','pickupSpawner','hazardSpawner','movingHazard','hazardDamage','spawnNextFaller','enemySpawner','enemyMove','enemyContactDamage','scoreThresholdWin'];
  // 'lineClear' is now included in this prototype's combo after decomposing
  // locked multi-cell FALLERs into 1x1 locked cells at lock time.

  console.log('--- random vs random ---');
  let r = runMatch(COMBO, 150, [randomAgent, randomAgent]);
  console.log('ended at tick', r.ended, 'score', r.w.score);
  const uniqueAtoms = new Set();
  for (const e of r.log) for (const a of e.atoms) uniqueAtoms.add(a);
  console.log('unique event types fired:', [...uniqueAtoms]);

  console.log('--- lookahead vs random ---');
  let total=0, wins=0, ticksSum=0;
  const t0=Date.now();
  for (let i=0;i<6;i++){
    const agents = i%2===0 ? [(w,rl,s)=>lookaheadAgent(w,rl,s,2), randomAgent]
                            : [randomAgent, (w,rl,s)=>lookaheadAgent(w,rl,s,2)];
    const res = runMatch(COMBO, 100, agents);
    const smartSide = i%2===0 ? 0 : 1;
    total++; ticksSum+=res.ended;
    if (res.w.score[smartSide] > res.w.score[1-smartSide]) wins++;
  }
  console.log(`lookahead won ${wins}/${total}, avg ticks ${(ticksSum/total).toFixed(0)}, took ${Date.now()-t0}ms`);

  console.log('--- decisiveness across 6 matches ---');
  let decisive=0;
  for (let i=0;i<6;i++){
    const res = runMatch(COMBO, 150, [randomAgent, randomAgent]);
    if (res.ended < 150 && res.ended > 3) decisive++;
  }
  console.log(`decisive (3<ticks<150): ${decisive}/6`);
}
