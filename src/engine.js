// ===================== ECS-lite: flat arrays, entity IDs =====================
// A "world" = component arrays indexed by entity id, plus a grid of cell->entity.
// Goal-agnostic: the Judge reads tags to find what to optimize (SCORE/HEALTH owners).

const TAG = { PLAYER:1, ENEMY:2, BLOCK:4, PROJECTILE:8, HAZARD:16, PICKUP:32, WALL:64, FALLER:128, BONUS:256 };

function makeWorld(W, H){
  return {
    W, H,
    grid: new Int32Array(W*H).fill(-1),     // cell -> entity id, -1 empty
    // components, parallel arrays; alive[i]===0 means slot is free
    alive: [], x: [], y: [], cells: [],     // cells: local offsets [[dx,dy],...]
    vx: [], vy: [], tickRate: [], tickCtr: [], locked: [],
    hp: [], tags: [],
    score: [0,0],                            // per-side score (side 0/1)
    side: [],                                // -1 = neutral
    tick: 0, log: [], over: false, winner: null,
    lookahead: false,                        // true in cloneWorld() — spawners skip when set
  };
}

function addEntity(w, {x,y,cells,vx=0,vy=0,tickRate=1,hp=0,tags=0,side=-1}){
  let id = w.alive.indexOf(0);          // recycle a dead slot if one exists
  if (id === -1){
    id = w.alive.length;
    w.alive.push(1); w.x.push(0); w.y.push(0); w.cells.push(null);
    w.vx.push(0); w.vy.push(0); w.tickRate.push(1); w.tickCtr.push(0); w.locked.push(0);
    w.hp.push(0); w.tags.push(0); w.side.push(-1);
  }
  w.alive[id]=1; w.x[id]=x; w.y[id]=y; w.cells[id]=cells;
  w.vx[id]=vx; w.vy[id]=vy; w.tickRate[id]=tickRate; w.tickCtr[id]=0; w.locked[id]=0;
  w.hp[id]=hp; w.tags[id]=tags; w.side[id]=side;
  paintEntity(w, id);
  return id;
}
function cellsOf(w, id){
  return w.cells[id].map(([dx,dy]) => [w.x[id]+dx, w.y[id]+dy]);
}
function paintEntity(w, id){
  if (!w.alive[id]) return;
  for (const [cx,cy] of cellsOf(w, id))
    if (cx>=0&&cx<w.W&&cy>=0&&cy<w.H) w.grid[cy*w.W+cx] = id;
}
function unpaintEntity(w, id){
  for (const [cx,cy] of cellsOf(w, id)){
    const i = cy*w.W+cx;
    if (cx>=0&&cx<w.W&&cy>=0&&cy<w.H && w.grid[i] === id) w.grid[i] = -1;
  }
}
function killEntity(w, id){
  unpaintEntity(w, id);
  w.alive[id] = 0;
}

function decomposeLockedFaller(w, id){
  if (!w.alive[id] || !(w.tags[id] & TAG.FALLER) || !w.locked[id]) return;
  const side = w.side[id];
  const tags = w.tags[id];
  const hp = w.hp[id];
  const cellPositions = cellsOf(w, id);
  killEntity(w, id);
  for (const [cx, cy] of cellPositions){
    const newId = addEntity(w, {
      x: cx, y: cy, cells: [[0,0]], vx: 0, vy: 0,
      tickRate: 1, hp, tags, side,
    });
    w.locked[newId] = 1;
  }
}

// deep clone for AI lookahead -- flat arrays make this cheap
function cloneWorld(w){
  return {
    W:w.W, H:w.H, grid:w.grid.slice(), lookahead:true,
    alive:w.alive.slice(), x:w.x.slice(), y:w.y.slice(),
    cells:w.cells.map(c=>c.map(p=>p.slice())),
    vx:w.vx.slice(), vy:w.vy.slice(), tickRate:w.tickRate.slice(), tickCtr:w.tickCtr.slice(), locked:w.locked.slice(),
    hp:w.hp.slice(), tags:w.tags.slice(), side:w.side.slice(),
    score:w.score.slice(), tick:w.tick, log:[], over:w.over, winner:w.winner,
  };
}

// ===================== the 8 atoms =====================
// Each atom = {id, on:'tick'|'collision'|'input', filter, apply}
// apply receives (w, ctx) and mutates w. ctx = {id, other, input, side}

const ATOMS = {
  // 1. GRAVITY: FALLER entities drift down each tick (subject to collision)
  gravity: {
    id:'gravity', on:'tick',
    filter: (w,id) => (w.tags[id] & TAG.FALLER) && w.vy[id]===0 && !w.locked[id],
    apply: (w,id) => { w.vy[id] = 1; },
  },
  // 2. APPLY_VELOCITY + propose/verify collision -> queues 'collision' events
  applyVelocity: {
    id:'apply_velocity', on:'tick',
    filter: (w,id) => (w.vx[id]!==0 || w.vy[id]!==0) && !w.locked?.[id],
    apply: (w,id,ctx) => {
      w.tickCtr[id]++;
      if (w.tickCtr[id] < w.tickRate[id]) return;
      w.tickCtr[id] = 0;
      const dx=w.vx[id], dy=w.vy[id];
      const proposed = cellsOf(w,id).map(([cx,cy])=>[cx+dx,cy+dy]);
      let blocked=null;
      for (const [cx,cy] of proposed){
        if (cx<0||cx>=w.W||cy<0||cy>=w.H){ blocked='wall'; break; }
        const occ = w.grid[cy*w.W+cx];
        if (occ!==-1 && occ!==id){ blocked=occ; break; }
      }
      if (blocked==='wall'){
        ctx.events.push({type:'hit_wall', id});
      } else if (blocked!==null){
        ctx.events.push({type:'collision', a:id, b:blocked});
      } else {
        unpaintEntity(w,id); w.x[id]+=dx; w.y[id]+=dy; paintEntity(w,id);
      }
    },
  },
  // 3. LINE_CLEAR: a fully-occupied row of FALLER cells clears, scorer = side 0
  lineClear: {
    id:'line_clear', on:'tick',
    filter: ()=>true, global:true,           // runs once per tick, not per-entity
    apply: (w,_,ctx) => {
      for (let y=0;y<w.H;y++){
        let full=true;
        for (let x=0;x<w.W;x++) if (w.grid[y*w.W+x]===-1){ full=false; break; }
        if (!full) continue;
        // clear every FALLER cell in this row; shift the FALLER stack above down
        for (let x=0;x<w.W;x++){
          const id=w.grid[y*w.W+x];
          if (id===-1) continue;
          if (!(w.tags[id]&TAG.FALLER)) continue;
          // remove just this cell from the entity's shape
          w.cells[id] = w.cells[id].filter(([dx,dy]) => w.y[id]+dy !== y);
          w.grid[y*w.W+x] = -1;
          if (w.cells[id].length===0) killEntity(w,id);
        }
        for (let x=0;x<w.W;x++){
          for (let yy=y; yy>0; yy--){
            const above = w.grid[(yy-1)*w.W+x];
            if (above!==-1 && (w.tags[above]&TAG.FALLER)){
              // shift that cell down by adjusting any local cell at row yy-1
              const id=above;
              for (const c of w.cells[id]) if (w.y[id]+c[1]===yy-1) c[1]++;
            }
          }
        }
        // repaint everything (simplicity over micro-perf at this scale)
        w.grid.fill(-1);
        for (let i=0;i<w.alive.length;i++) if (w.alive[i]) paintEntity(w,i);
        w.score[0] += 10;
        ctx.events.push({type:'line_clear', row:y});
        y--; // re-check same row index after shift
      }
    },
  },
  // 4. PLAYER_INPUT: PLAYER entity moves by input (left/right/rotate/wait)
  playerInput: {
    id:'player_input', on:'input',
    filter: (w,id) => !!(w.tags[id]&TAG.PLAYER),
    apply: (w,id,ctx) => {
      const inp = ctx.input;
      if (inp==='left' || inp==='right'){
        const dx = inp==='left' ? -1 : 1;
        const proposed = cellsOf(w,id).map(([cx,cy])=>[cx+dx,cy]);
        let blocked = null;
        for (const [cx,cy] of proposed){
          if (cx<0||cx>=w.W||cy<0||cy>=w.H){ blocked='wall'; break; }
          const occ = w.grid[cy*w.W+cx];
          if (occ!==-1 && occ!==id){ blocked=occ; break; }
        }
        if (blocked===null){
          unpaintEntity(w,id); w.x[id]+=dx; paintEntity(w,id);
        } else if (blocked !== 'wall'){
          ctx.events.push({type:'collision', a:id, b:blocked});
        }
      } else if (inp==='rotate'){
        const rotated = w.cells[id].map(([dx,dy])=>[-dy,dx]);
        const proposed = rotated.map(([dx,dy])=>[w.x[id]+dx,w.y[id]+dy]);
        if (proposed.every(([cx,cy]) => cx>=0&&cx<w.W&&cy>=0&&cy<w.H &&
            (w.grid[cy*w.W+cx]===-1 || w.grid[cy*w.W+cx]===id))){
          unpaintEntity(w,id); w.cells[id]=rotated; paintEntity(w,id);
        }
      } else if (inp==='shoot'){
        ctx.events.push({type:'shoot_request', id});
      }
    },
  },

  // MOVE_VERTICAL: allow PLAYER entities to move up/down (e.g. for simple navigation)
  moveVertical: {
    id: 'move_vertical', on: 'input',
    filter: (w,id) => !!(w.tags[id]&TAG.PLAYER),
    apply: (w,id,ctx) => {
      const inp = ctx.input;
      if (inp === 'up' || inp === 'down'){
        const dy = inp === 'up' ? -1 : 1;
        const proposed = cellsOf(w,id).map(([cx,cy]) => [cx, cy+dy]);
        if (proposed.every(([cx,cy]) => cx>=0&&cx<w.W&&cy>=0&&cy<w.H &&
            (w.grid[cy*w.W+cx]===-1 || w.grid[cy*w.W+cx]===id))){
          unpaintEntity(w,id); w.y[id]+=dy; paintEntity(w,id);
        }
      }
    }
  },
  // 5. SHOOT: spawns a PROJECTILE moving up from a PLAYER, on shoot_request
  shoot: {
    id:'shoot', on:'event', match:'shoot_request',
    apply: (w,ev,ctx) => {
      const id=ev.id;
      const px=w.x[id];
      const vy = w.side[id]===1 ? 1 : -1;
      const py=w.y[id]+vy;
      if (py<0||py>=w.H||w.grid[py*w.W+px]!==-1) return;
      if (w.alive.length >= 400) return;   // safety cap
      addEntity(w,{x:px,y:py,cells:[[0,0]],vy, tickRate:1,
        tags:TAG.PROJECTILE, side:w.side[id]});
    },
  },
  // 6. DAMAGE_ON_COLLISION: PROJECTILE hitting ENEMY/PLAYER/FALLER reduces HP
  damageOnCollision: {
    id:'damage_on_collision', on:'event', match:'collision',
    apply: (w,ev,ctx) => {
      const {a,b}=ev;
      const proj = (w.tags[a]&TAG.PROJECTILE) ? a : (w.tags[b]&TAG.PROJECTILE) ? b : null;
      const other = proj===a ? b : a;
      if (proj===null) return;
      if (w.hp[other] > 0){
        w.hp[other] -= 1;
        if (w.hp[other] <= 0){
          if (w.side[other]===0) w.score[1]+=5; else if (w.side[other]===1) w.score[0]+=5;
          killEntity(w,other);
        }
      }
      killEntity(w,proj);
    },
  },
  knockbackOnCollision: {
    id:'knockback_on_collision', on:'event', match:'collision',
    apply: (w,ev,ctx) => {
      const {a,b} = ev;
      const proj = (w.tags[a]&TAG.PROJECTILE) ? a : (w.tags[b]&TAG.PROJECTILE) ? b : null;
      const other = proj===a ? b : a;
      if (proj===null) return;
      const dx = Math.sign(w.x[other] - w.x[proj]);
      const dy = Math.sign(w.y[other] - w.y[proj]);
      if (dx===0 && dy===0) return;
      const targetX = w.x[other] + dx;
      const targetY = w.y[other] + dy;
      if (targetX < 0 || targetX >= w.W || targetY < 0 || targetY >= w.H) return;
      const targetOcc = w.grid[targetY*w.W+targetX];
      if (targetOcc === -1){
        unpaintEntity(w, other);
        w.x[other] = targetX;
        w.y[other] = targetY;
        paintEntity(w, other);
      }
    },
  },
  projectileBounceOnWall: {
    id:'projectile_bounce_on_wall', on:'event', match:'hit_wall',
    apply: (w,ev,ctx) => {
      const id = ev.id;
      if (!(w.tags[id]&TAG.PROJECTILE)) return;
      if (w.vy[id]!==0) w.vy[id] *= -1;
      else if (w.vx[id]!==0) w.vx[id] *= -1;
    },
  },
  // 7. HIT_WALL_FOR_FALLER: a FALLER hitting the floor/another faller LOCKS in place
  lockOnHitWall: {
    id:'lock_on_hit_wall', on:'event', match:'hit_wall',
    apply: (w,ev,ctx) => {
      const id=ev.id;
      if (!(w.tags[id]&TAG.FALLER) || w.locked[id]) return;
      w.vx[id]=0; w.vy[id]=0; w.locked[id]=1;
      decomposeLockedFaller(w, id);
      ctx.events.push({type:'spawn_next_faller'});
    },
  },
  lockOnCollisionFaller: {
    id:'lock_on_collision_faller', on:'event', match:'collision',
    apply: (w,ev,ctx) => {
      for (const id of [ev.a, ev.b]){
        if (id<0) continue;
        if ((w.tags[id]&TAG.FALLER) && !w.locked[id]){
          w.vx[id]=0; w.vy[id]=0; w.locked[id]=1;
          decomposeLockedFaller(w, id);
          ctx.events.push({type:'spawn_next_faller'});
        }
      }
    },
  },
  // 7'. PROJECTILE hitting a wall is removed
  destroyProjectileOnWall: {
    id:'destroy_projectile_on_wall', on:'event', match:'hit_wall',
    apply: (w,ev,ctx) => {
      const id=ev.id;
      if (w.tags[id]&TAG.PROJECTILE) killEntity(w,id);
    },
  },
  spawnNextFaller: {
    id:'spawn_next_faller', on:'event', match:'spawn_next_faller',
    apply: (w,ev,ctx) => {
      const shapes = [
        [[0,0]],
        [[0,0],[1,0]],
        [[0,0],[0,1]],
        [[0,0],[1,0],[0,1]],
      ];
      const shape = shapes[(Math.random()*shapes.length)|0];
      const x0 = (w.W - 2) >> 1;
      const y0 = 0;
      const cells = shape.map(([dx,dy]) => [dx,dy]);
      const occupied = cells.some(([dx,dy]) => {
        const cx = x0+dx, cy = y0+dy;
        return cx<0||cx>=w.W||cy<0||cy>=w.H || w.grid[cy*w.W+cx]!==-1;
      });
      if (occupied || w.alive.length >= 400) return;
      addEntity(w,{x:x0,y:y0,cells,vy:0,tickRate:1,tags:TAG.FALLER,side:-1});
    },
  },
  pickupSpawner: {
    id:'pickup_spawner', on:'tick', global:true,
    filter: (w,_) => !w.lookahead && w.tick % 20 === 0,
    apply: (w,_,ctx) => {
      const count = w.alive.reduce((sum,id) => sum + ((w.alive[id] && (w.tags[id]&TAG.PICKUP)) ? 1 : 0), 0);
      if (count > 3) return;
      const x = (Math.random()*w.W)|0;
      const y = (Math.random()*w.H)|0;
      if (w.grid[y*w.W+x] !== -1) return;
      addEntity(w,{x,y,cells:[[0,0]],tags:TAG.PICKUP});
    },
  },
  hazardSpawner: {
    id:'hazard_spawner', on:'tick', global:true,
    filter: (w,_) => !w.lookahead && w.tick % 30 === 0,
    apply: (w,_,ctx) => {
      const count = w.alive.reduce((sum,id) => sum + ((w.alive[id] && (w.tags[id]&TAG.HAZARD)) ? 1 : 0), 0);
      if (count > 1) return;
      const x = (Math.random()*w.W)|0;
      const y = (Math.random()*w.H)|0;
      if (w.grid[y*w.W+x] !== -1) return;
      addEntity(w,{x,y,cells:[[0,0]],tags:TAG.HAZARD});
    },
  },
  respawnPlayer: {
    id:'respawn_player', on:'tick', global:true,
    filter: (w)=>!w.lookahead,
    apply: (w,_,ctx) => {
      const aliveSides = [false,false];
      for (let id = 0; id < w.alive.length; id++){
        if (!w.alive[id] || !(w.tags[id]&TAG.PLAYER)) continue;
        if (w.side[id]===0) aliveSides[0]=true;
        if (w.side[id]===1) aliveSides[1]=true;
      }
      for (const side of [0,1]){
        if (!aliveSides[side] && w.tick % 10 === 0){
          const y = side===0 ? w.H-1 : 0;
          addEntity(w,{x:3,y, cells:[[0,0]], hp:5, tags:TAG.PLAYER, side});
        }
      }
    },
  },
  hazardDamage: {
    id:'hazard_damage', on:'tick',
    filter: (w,id) => !!(w.tags[id] & TAG.HAZARD),
    apply: (w,id,ctx) => {
      const adj = [[1,0],[-1,0],[0,1],[0,-1],[0,0]];
      for (const [dx,dy] of adj){
        const x = w.x[id] + dx;
        const y = w.y[id] + dy;
        if (x<0||x>=w.W||y<0||y>=w.H) continue;
        const victim = w.grid[y*w.W+x];
        if (victim===-1 || !(w.tags[victim]&TAG.PLAYER)) continue;
        if (w.hp[victim] > 0){
          w.hp[victim] -= 1;
          if (w.hp[victim] <= 0){
            if (w.side[victim]===0) w.score[1]+=5; else if (w.side[victim]===1) w.score[0]+=5;
            killEntity(w,victim);
          }
        }
      }
    },
  },
  // 8. PICKUP: PLAYER moving onto a PICKUP cell scores points and removes it
  pickupOnCollision: {
    id:'pickup_on_collision', on:'event', match:'collision',
    apply: (w,ev,ctx) => {
      const {a,b}=ev;
      const pick = (w.tags[a]&TAG.PICKUP) ? a : (w.tags[b]&TAG.PICKUP) ? b : null;
      const other = pick===a ? b : a;
      if (pick===null) return;
      if (w.tags[other]&TAG.PLAYER){
        const s = w.side[other];
        if (s===0||s===1) w.score[s]+=3;
        killEntity(w,pick);
      }
    },
  },
  healOnPickup: {
    id:'heal_on_pickup', on:'event', match:'collision',
    apply: (w,ev,ctx) => {
      const {a,b}=ev;
      const pick = (w.tags[a]&TAG.PICKUP) ? a : (w.tags[b]&TAG.PICKUP) ? b : null;
      const other = pick===a ? b : a;
      if (pick===null) return;
      if (w.tags[other]&TAG.PLAYER){
        w.hp[other] += 1;
      }
    },
  },

  // MOVING_HAZARD: HAZARD entities walk left/right each tick, bouncing off walls.
  // Uses tickCtr as direction memory (0 = right, 1 = left). No vx/vy so
  // applyVelocity ignores these entities.
  movingHazard: {
    id:'moving_hazard', on:'tick',
    filter: (w,id) => !!(w.tags[id] & TAG.HAZARD),
    apply: (w,id,ctx) => {
      const dx = w.tickCtr[id] === 0 ? 1 : -1;
      const proposed = cellsOf(w,id).map(([cx,cy]) => [cx+dx, cy]);
      let blocked = false;
      for (const [cx,cy] of proposed){
        if (cx<0||cx>=w.W||cy<0||cy>=w.H){ blocked=true; break; }
        const occ = w.grid[cy*w.W+cx];
        if (occ!==-1 && occ!==id){ blocked=true; break; }
      }
      if (blocked){
        w.tickCtr[id] = 1 - w.tickCtr[id];
      } else {
        unpaintEntity(w,id); w.x[id]+=dx; paintEntity(w,id);
      }
    },
  },

  // SCORE_THRESHOLD_WIN: when any side reaches 30 points, game ends.
  // Sets w.over and w.winner so the match runner can detect a score-based win.
  scoreThresholdWin: {
    id:'score_threshold_win', on:'tick', global:true,
    filter: ()=>true,
    apply: (w,_,ctx) => {
      if (w.over) return;
      const threshold = 30;
      if (w.score[0] >= threshold){
        w.over=true; w.winner=0; ctx.events.push({type:'score_win', winner:0});
      } else if (w.score[1] >= threshold){
        w.over=true; w.winner=1; ctx.events.push({type:'score_win', winner:1});
      }
    },
  },

  // ENEMY_SPAWNER: periodically spawns ENEMY entities (up to 2 at a time).
  enemySpawner: {
    id:'enemy_spawner', on:'tick', global:true,
    filter: (w,_) => !w.lookahead && w.tick % 25 === 0,
    apply: (w,_,ctx) => {
      const count = w.alive.reduce((s,v,i)=>s+((v&&(w.tags[i]&TAG.ENEMY))?1:0),0);
      if (count >= 2 || w.alive.length >= 400) return;
      const x = (Math.random()*w.W)|0;
      const y = ((Math.random()*(w.H-2))+1)|0;
      if (w.grid[y*w.W+x]!==-1) return;
      addEntity(w,{x,y,cells:[[0,0]],hp:3,tags:TAG.ENEMY,side:-1});
      ctx.events.push({type:'enemy_spawn'});
    },
  },

  // ENEMY_MOVE: ENEMY entities chase the nearest PLAYER.
  // Throttled to one step every 3 ticks via tickCtr. Fires 'collision' when adjacent.
  enemyMove: {
    id:'enemy_move', on:'tick',
    filter: (w,id) => !!(w.tags[id] & TAG.ENEMY),
    apply: (w,id,ctx) => {
      w.tickCtr[id]++;
      if (w.tickCtr[id] < 3) return;
      w.tickCtr[id] = 0;
      let nearestDist=Infinity, targetX=w.x[id], targetY=w.y[id];
      for (let pid=0; pid<w.alive.length; pid++){
        if (!w.alive[pid]||!(w.tags[pid]&TAG.PLAYER)) continue;
        const dist=Math.abs(w.x[pid]-w.x[id])+Math.abs(w.y[pid]-w.y[id]);
        if (dist<nearestDist){ nearestDist=dist; targetX=w.x[pid]; targetY=w.y[pid]; }
      }
      const dx=Math.sign(targetX-w.x[id]);
      const dy=Math.sign(targetY-w.y[id]);
      for (const [mx,my] of [[dx,0],[0,dy]]){
        if (mx===0 && my===0) continue;
        const nx=w.x[id]+mx, ny=w.y[id]+my;
        if (nx<0||nx>=w.W||ny<0||ny>=w.H) continue;
        const occ=w.grid[ny*w.W+nx];
        if (occ===-1){
          unpaintEntity(w,id); w.x[id]=nx; w.y[id]=ny; paintEntity(w,id);
          break;
        } else if (w.tags[occ]&TAG.PLAYER){
          ctx.events.push({type:'collision', a:id, b:occ});
          break;
        }
      }
    },
  },

  // ENEMY_CONTACT_DAMAGE: ENEMY colliding with PLAYER reduces the player's HP.
  enemyContactDamage: {
    id:'enemy_contact_damage', on:'event', match:'collision',
    apply: (w,ev,ctx) => {
      const {a,b}=ev;
      const enemy=(w.tags[a]&TAG.ENEMY)?a:(w.tags[b]&TAG.ENEMY)?b:null;
      const other=enemy===a?b:a;
      if (enemy===null||!(w.tags[other]&TAG.PLAYER)) return;
      if (w.hp[other]>0){
        w.hp[other]-=1;
        if (w.hp[other]<=0){
          if (w.side[other]===0) w.score[1]+=5; else if (w.side[other]===1) w.score[0]+=5;
          killEntity(w,other);
        }
      }
    },
  },
};

// ===================== the tick loop =====================
// Phases: 1) input  2) tick atoms (gravity, velocity)  3) process events
//         4) global atoms (line clear)  5) over-check

function step(w, rules, input){
  const ctx = {events:[]};
  // 1. input
  for (const a of rules.input) for (let id=0;id<w.alive.length;id++){
    if (!w.alive[id] || !a.filter(w,id)) continue;
    const inp = (input && typeof input === 'object' && input[id] !== undefined)
      ? input[id]
      : input;
    a.apply(w,id,{...ctx, input: inp});
  }
  // 2. per-entity tick atoms
  for (const a of rules.tick.filter(a=>!a.global))
    for (let id=0;id<w.alive.length;id++)
      if (w.alive[id] && a.filter(w,id)) a.apply(w,id,ctx);
  // 3. process events (may enqueue more; bounded iterations)
  for (let round=0; round<4 && ctx.events.length; round++){
    const batch = ctx.events; ctx.events=[];
    for (const ev of batch){
      for (const a of rules.event)
        if (a.match===ev.type) a.apply(w,ev,ctx);
    }
  }
  // 4. global tick atoms (line clear etc.)
  for (const a of rules.tick.filter(a=>a.global)) a.apply(w,null,ctx);
  // 5. spawn_next_faller events from global pass too -- cap: lookahead clones
  //    don't get a real spawner, so drop unhandled spawn events here to avoid
  //    silent no-ops growing ctx.events forever
  for (let round=0; round<2 && ctx.events.length; round++){
    const batch = ctx.events; ctx.events=[];
    for (const ev of batch) for (const a of rules.event) if (a.match===ev.type) a.apply(w,ev,ctx);
  }
  w.tick++;
}

function buildRules(atomIds){
  const rules = {input:[], tick:[], event:[]};
  for (const id of atomIds){
    const a = ATOMS[id];
    if (a.on==='tick') rules.tick.push(a);
    else if (a.on==='input') rules.input.push(a);
    else if (a.on==='event') rules.event.push(a);
  }
  // hard safety cap shared by all event handlers that spawn entities
  rules.MAX_ENTITIES = 400;
  return rules;
}

// ===================== generic clone-based lookahead agent =====================
function evaluate(w, side){
  // goal-agnostic: read whichever side's score, plus survival proxy (own HP/pieces alive)
  let mine=0, theirs=0;
  for (let id=0; id<w.alive.length; id++){
    if (!w.alive[id]) continue;
    if (w.side[id]===side) mine += Math.max(0,w.hp[id]) + 1;
    else if (w.side[id]===1-side) theirs += Math.max(0,w.hp[id]) + 1;
  }
  return w.score[side]*10 - w.score[1-side]*10 + mine*0.5 - theirs*0.5;
}
const INPUTS = ['left','right','up','down','rotate','shoot','wait'];
function lookaheadAgent(w, rules, side, depth=3){
  const playerIds = [];
  for (let id=0; id<w.alive.length; id++){
    if (!w.alive[id]) continue;
    if (w.side[id]===side && (w.tags[id]&TAG.PLAYER)) playerIds.push(id);
  }
  let best='wait', bs=-Infinity;
  for (const inp of INPUTS){
    let sim = cloneWorld(w);
    for (let t=0;t<depth;t++){
      const stepInput = t===0 ? Object.fromEntries(playerIds.map(id=>[id, inp])) : {};
      step(sim, rules, stepInput);
    }
    const v = evaluate(sim, side);
    if (v>bs){ bs=v; best=inp; }
  }
  return best;
}
function randomAgent(w, rules, side){
  return INPUTS[(Math.random()*INPUTS.length)|0];
}

// ===================== exports =====================
if (typeof module !== 'undefined') {
  module.exports = {
    TAG, ATOMS,
    makeWorld, addEntity, cellsOf, paintEntity, unpaintEntity, killEntity, cloneWorld,
    buildRules, step,
    evaluate, lookaheadAgent, randomAgent, INPUTS,
  };
}
