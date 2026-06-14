const { cellsOf } = require('../src/engine');

function assertWorldValid(w, label='world'){
  // 1) every alive entity's painted cells match w.grid
  for (let id=0; id<w.alive.length; id++){
    if (!w.alive[id]) continue;
    const cells = cellsOf(w, id);
    for (const [cx,cy] of cells){
      if (cx < 0 || cx >= w.W || cy < 0 || cy >= w.H) throw new Error(`${label}: entity ${id} has cell out of bounds ${cx},${cy}`);
      const idx = cy*w.W + cx;
      if (w.grid[idx] !== id) throw new Error(`${label}: entity ${id} cell ${cx},${cy} not painted as ${id} (grid=${w.grid[idx]})`);
    }
  }

  // 2) no two alive entities claim the same grid cell (grid already encodes this, but check consistency)
  for (let y=0;y<w.H;y++) for (let x=0;x<w.W;x++){
    const idx = y*w.W + x; const id = w.grid[idx];
    if (id === -1) continue;
    if (!w.alive[id]) throw new Error(`${label}: grid cell ${x},${y} points to dead entity ${id}`);
    // ensure the entity actually covers this cell
    const covers = cellsOf(w, id).some(([cx,cy]) => cx===x && cy===y);
    if (!covers) throw new Error(`${label}: grid cell ${x},${y} references ${id} but entity does not cover it`);
  }

  // 3) alive count under a sensible bound (safety cap to catch explosions)
  const aliveCount = w.alive.reduce((s,v)=>s+(v?1:0),0);
  const cap = 400;
  if (aliveCount > cap) throw new Error(`${label}: alive entity count ${aliveCount} exceeds cap ${cap}`);
}

module.exports = { assertWorldValid };
