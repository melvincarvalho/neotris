'use strict';
/* NEOTRIS — a Tetris tribute built by a harsh-critic agent loop.
   Copyright (C) 2026 Melvin Carvalho — AGPL-3.0-or-later.
   Original presentation; Tetris (Alexey Pajitnov, 1984) and the modern
   Guideline rules it grew into are respected here, not owned. */

// ------------------------------ seeded RNG ------------------------------
let _s = 1;
function srand(s) { _s = (s >>> 0) || 1; }
function rand() { _s ^= _s << 13; _s >>>= 0; _s ^= _s >>> 17; _s ^= _s << 5; _s >>>= 0; return _s / 4294967296; }
// pure hash — render-side only, never the sim stream
function hash32(a, b, c) {
  let h = 2166136261 >>> 0; const str = a + '|' + b + '|' + (c || 0);
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h / 4294967296;
}

// ------------------------------ the rules ------------------------------
const W = 10, H = 22, HIDDEN = 2;          // rows 0..1 hidden above the well
const KINDS = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];
const COL = { I: '#3ef0ff', J: '#2f5cff', L: '#ff9330', O: '#ffe14a', S: '#3eff6e', T: '#b23dff', Z: '#ff3355' };
const SHAPES = {
  I: [[[0, 1], [1, 1], [2, 1], [3, 1]], [[2, 0], [2, 1], [2, 2], [2, 3]], [[0, 2], [1, 2], [2, 2], [3, 2]], [[1, 0], [1, 1], [1, 2], [1, 3]]],
  J: [[[0, 0], [0, 1], [1, 1], [2, 1]], [[1, 0], [2, 0], [1, 1], [1, 2]], [[0, 1], [1, 1], [2, 1], [2, 2]], [[1, 0], [1, 1], [0, 2], [1, 2]]],
  L: [[[2, 0], [0, 1], [1, 1], [2, 1]], [[1, 0], [1, 1], [1, 2], [2, 2]], [[0, 1], [1, 1], [2, 1], [0, 2]], [[0, 0], [1, 0], [1, 1], [1, 2]]],
  O: [[[1, 0], [2, 0], [1, 1], [2, 1]], [[1, 0], [2, 0], [1, 1], [2, 1]], [[1, 0], [2, 0], [1, 1], [2, 1]], [[1, 0], [2, 0], [1, 1], [2, 1]]],
  S: [[[1, 0], [2, 0], [0, 1], [1, 1]], [[1, 0], [1, 1], [2, 1], [2, 2]], [[1, 1], [2, 1], [0, 2], [1, 2]], [[0, 0], [0, 1], [1, 1], [1, 2]]],
  T: [[[1, 0], [0, 1], [1, 1], [2, 1]], [[1, 0], [1, 1], [2, 1], [1, 2]], [[0, 1], [1, 1], [2, 1], [1, 2]], [[1, 0], [0, 1], [1, 1], [1, 2]]],
  Z: [[[0, 0], [1, 0], [1, 1], [2, 1]], [[2, 0], [1, 1], [2, 1], [1, 2]], [[0, 1], [1, 1], [1, 2], [2, 2]], [[1, 0], [0, 1], [1, 1], [0, 2]]],
};
// SRS wall kicks, written with y pointing DOWN (the canonical tables are y-up, negated here)
const KICK = {
  '01': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '10': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '12': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '21': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '23': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '32': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '30': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '03': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
};
const KICK_I = {
  '01': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
  '10': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
  '12': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
  '21': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
  '23': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
  '32': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
  '30': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
  '03': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
};
const LOCK_DELAY = 0.5, LOCK_RESETS = 15, CLEAR_T = 0.34;
const DAS = 0.17, ARR = 0.018;
function gravityInterval(level) {
  const l = Math.min(115, Math.max(1, level));   // beyond this the curve would sign-flip
  return Math.max(1 / 60, Math.pow(0.8 - (l - 1) * 0.007, l - 1));
}

let G = null;

function newGame(seed, opts) {
  opts = opts || {};
  srand((seed ^ 0x7E7415) >>> 0);
  G = {
    seed, board: new Array(W * H).fill(null),
    bag: [], queue: [], piece: null, hold: null, holdUsed: false,
    score: 0, lines: 0, level: 1, combo: -1, b2b: false, pieces: 0,
    tetrises: 0, tspins: 0, best: 0, over: false, screen: 'play',
    gTimer: 0, lockT: 0, lockResets: 0, grounded: false,
    clearing: null, time: 0, shake: 0, banner: null, fx: [], drops: [], dust: [], lockFx: null,
    lastKick: 0, lastWasRotate: false, headless: !!opts.headless,
    shotMode: false, muted: false, das: { dir: 0, t: 0, arr: 0 }, softing: false,
    scorePop: 0, shownScore: 0, statLine: '', elapsed: 0, lastPoints: 0,
  };
  refill(); refill();
  spawnNext();
  return G;
}
function refill() {
  if (G.queue.length > 7) return;
  const b = KINDS.slice();
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = b[i]; b[i] = b[j]; b[j] = t; }
  for (const k of b) G.queue.push(k);
}
function cellsOf(kind, rot, x, y) {
  const out = [];
  for (const [cx, cy] of SHAPES[kind][rot & 3]) out.push([x + cx, y + cy]);
  return out;
}
function fits(kind, rot, x, y) {
  for (const [bx, by] of cellsOf(kind, rot, x, y)) {
    if (bx < 0 || bx >= W || by >= H || by < 0) return false;  // nothing may leave the well
    if (G.board[by * W + bx]) return false;
  }
  return true;
}
function spawnNext(forced) {
  refill();
  const kind = forced || G.queue.shift();
  const p = { kind, rot: 0, x: 3, y: 1 };
  G.piece = p; G.holdUsed = false;
  G.gTimer = 0; G.lockT = 0; G.lockResets = 0; G.grounded = false; G.lastWasRotate = false;
  if (!fits(p.kind, p.rot, p.x, p.y)) { G.piece = null; topOut(); return false; }
  return true;
}
let overAt = 0;
function topOut() { G.over = true; G.screen = 'over'; G.banner = null; overAt = Date.now(); if (G.score > G.best) G.best = G.score; }
function bestOf(g) { return g && g.best || 0; }
function ghostY() {
  const p = G.piece; if (!p) return 0;
  let y = p.y;
  while (fits(p.kind, p.rot, p.x, y + 1)) y++;
  return y;
}
function move(dx) {
  const p = G.piece;
  if (!p || G.clearing || G.over) return false;
  if (!fits(p.kind, p.rot, p.x + dx, p.y)) return false;
  p.x += dx; G.lastWasRotate = false;
  resetLock();
  return true;
}
function resetLock() {
  if (G.grounded && G.lockResets < LOCK_RESETS) { G.lockT = 0; G.lockResets++; }
}
function rotate(dir) {
  const p = G.piece;
  if (!p || G.clearing || G.over) return false;
  const from = p.rot & 3, to = (p.rot + (dir > 0 ? 1 : 3)) & 3;
  const table = p.kind === 'I' ? KICK_I : KICK;
  const kicks = table['' + from + to] || [[0, 0]];
  for (let i = 0; i < kicks.length; i++) {
    const [kx, ky] = kicks[i];
    if (fits(p.kind, to, p.x + kx, p.y + ky)) {
      p.rot = to; p.x += kx; p.y += ky;
      G.lastWasRotate = true; G.lastKick = i;
      resetLock();
      return true;
    }
  }
  return false;
}
function softDrop() {
  const p = G.piece;
  if (!p || G.clearing || G.over) return false;
  if (fits(p.kind, p.rot, p.x, p.y + 1)) { p.y++; G.score += 1; G.lastWasRotate = false; return true; }
  return false;
}
function hardDrop() {
  const p = G.piece;
  if (!p || G.clearing || G.over) return false;
  const gy = ghostY();
  const dist = gy - p.y;
  if (dist > 0) { G.drops.push({ x: p.x, kind: p.kind, rot: p.rot, y0: p.y, y1: gy, t: G.time }); G.lastWasRotate = false; }
  G.score += dist * 2;
  p.y = gy;
  G.shake = Math.max(G.shake, Math.min(0.5, 0.1 + dist * 0.022));
  lockPiece();
  return true;
}
function holdPiece() {
  if (!G.piece || G.holdUsed || G.clearing || G.over) return false;
  const cur = G.piece.kind;
  const swap = G.hold;
  G.hold = cur;
  if (swap) {
    G.piece = { kind: swap, rot: 0, x: 3, y: 1 };
    G.gTimer = 0; G.lockT = 0; G.lockResets = 0; G.grounded = false;
    if (!fits(swap, 0, 3, 1)) { G.piece = null; topOut(); }
  } else spawnNext();
  G.lastWasRotate = false;
  G.holdUsed = true;
  return true;
}
function cornersFilled(p) {
  const at = (bx, by) => (bx < 0 || bx >= W || by >= H) ? true : (by >= 0 && !!G.board[by * W + bx]);
  const c = [at(p.x, p.y), at(p.x + 2, p.y), at(p.x, p.y + 2), at(p.x + 2, p.y + 2)];
  const FRONT = [[0, 1], [1, 3], [3, 2], [2, 0]]; // by rotation: which two corners face the T's point
  const f = FRONT[p.rot & 3];
  return { total: c.filter(Boolean).length, front: (c[f[0]] ? 1 : 0) + (c[f[1]] ? 1 : 0) };
}
function detectTSpin(p) {
  if (p.kind !== 'T' || !G.lastWasRotate) return 0;
  const { total, front } = cornersFilled(p);
  if (total < 3) return 0;
  if (front === 2) return 2;              // full T-spin
  return G.lastKick === 4 ? 2 : 1;        // the far kick upgrades a mini to full
}
function lockPiece() {
  const p = G.piece;
  if (!p) return;
  const spin = detectTSpin(p);
  let allHidden = true;
  for (const [bx, by] of cellsOf(p.kind, p.rot, p.x, p.y)) {
    G.board[by * W + bx] = p.kind;
    if (by >= HIDDEN) allHidden = false;
  }
  G.pieces++;
  G.lockFx = { cells: cellsOf(p.kind, p.rot, p.x, p.y), col: COL[p.kind], t: G.time };
  for (const [bx, by] of G.lockFx.cells) {
    if (by < HIDDEN || G.board[(by + 1) * W + bx] || by === H - 1) {
      for (let i = 0; i < 3; i++)
        G.dust.push({ x: bx + 0.5, y: by + 1, vx: (hash32(bx, by, i) - 0.5) * 3.4,
          vy: -0.6 - hash32(by, bx, i) * 1.1, t: G.time, col: COL[p.kind] });
    }
  }
  if (G.dust.length > 120) G.dust.splice(0, G.dust.length - 120);
  G.piece = null;
  const rows = [];
  for (let y = 0; y < H; y++) {
    let full = true;
    for (let x = 0; x < W; x++) if (!G.board[y * W + x]) { full = false; break; }
    if (full) rows.push(y);
  }
  scoreClear(rows.length, spin, rows);
  if (rows.length) {
    const steps = Math.min(12, Math.max(0, G.combo) + (rows.length - 1) * 2);
    const base = 392 * Math.pow(2, steps / 12);
    beep(base, 0.13, 'triangle');
    if (rows.length >= 4 || spin) {
      beep(base * 1.26, 0.15, 'triangle', 0.07);
      beep(base * 1.5, 0.22, 'triangle', 0.14);
    }
  } else {
    beep(150, 0.05, 'square');
    beep(58, 0.11, 'sine');              // the thud of a piece finding the floor
  }
  if (rows.length) {
    G.clearing = { rows, t: 0 };
    G.shake = Math.max(G.shake, rows.length >= 4 ? 1 : 0.35);
    for (const y of rows) for (let x = 0; x < W; x++) G.fx.push({ x, y, t: G.time, col: COL[G.board[y * W + x]] || '#fff' });
    if (G.headless) resolveClear();
  } else if (allHidden) {
    topOut();  // lock-out: the piece finished entirely above the well
  } else {
    spawnNext();
  }
}
function scoreClear(n, spin, rows) {
  const L = G.level;
  const scoreBefore = G.score;
  let base = 0, label = '';
  if (spin === 2) {
    base = [400, 800, 1200, 1600][n] || 0;
    label = ['T-SPIN', 'T-SPIN SINGLE', 'T-SPIN DOUBLE', 'T-SPIN TRIPLE'][n] || 'T-SPIN';
  } else if (spin === 1) {
    base = [100, 200, 400][n] || 0;
    label = n ? 'T-SPIN MINI ' + n : 'T-SPIN MINI';
  } else {
    base = [0, 100, 300, 500, 800][n] || 0;
    label = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'TETRIS'][n] || '';
  }
  const hard = n === 4 || (spin > 0 && n > 0);
  if (hard && G.b2b && base) { base = Math.floor(base * 1.5); label = 'B2B ' + label; }
  if (base) G.score += base * L;
  if (n > 0) {
    G.combo++;
    if (G.combo > 0) G.score += 50 * G.combo * L;
    G.b2b = hard;
    G.lines += n;
    G.level = 1 + Math.floor(G.lines / 10);
    if (n === 4) G.tetrises++;
    if (spin) G.tspins++;
    // perfect clear: the well is empty once these rows go
    let empty = true;
    const pending = rows || [];
    for (let y = 0; y < H && empty; y++) {
      if (pending.indexOf(y) >= 0) continue;
      for (let x = 0; x < W; x++) if (G.board[y * W + x]) { empty = false; break; }
    }
    if (empty) {
      const pc = [0, 800, 1200, 1800, 2000][n] || 0;
      G.score += pc * L;
      label = 'PERFECT CLEAR';
      G.perfects = (G.perfects || 0) + 1;
    }
    G.lastPoints = G.score - scoreBefore;
    if (label) G.banner = { txt: label, t: G.time, pts: G.lastPoints, big: n >= 4 || !!spin,
      col: n === 4 ? '#ffe14a' : spin ? '#c86bff' : '#3ef0ff' };
    if (rows && rows.length) G.fx.push({ pop: '+' + G.lastPoints, x: W / 2, y: rows[rows.length - 1], t: G.time, col: '#ffffff' });
    G.statLine = label;
  } else {
    G.combo = -1;                        // any lock that clears nothing breaks the chain
    if (spin) {                          // ...and a spin without lines does not arm back-to-back
      G.lastPoints = G.score - scoreBefore;
      if (label) G.banner = { txt: label, t: G.time, pts: G.lastPoints, big: true, col: '#b23dff' };
    }
  }
}
function resolveClear() {
  const rows = G.clearing ? G.clearing.rows.slice() : [];
  const nb = [];
  for (let y = 0; y < H; y++) if (rows.indexOf(y) < 0) nb.push(G.board.slice(y * W, y * W + W));
  while (nb.length < H) nb.unshift(new Array(W).fill(null));
  G.board = [].concat.apply([], nb);
  G.clearing = null;
  spawnNext();
}
function tick(dt) {
  if (!G || G.over) return;
  G.time += dt;
  G.elapsed += dt;
  G.shake = Math.max(0, G.shake - dt * 3);
  if (G.clearing) {
    G.clearing.t += dt;
    if (G.clearing.t >= CLEAR_T) resolveClear();
    return;
  }
  const p = G.piece;
  if (!p) return;
  // DAS / ARR
  if (G.das.dir) {
    G.das.t += dt;
    if (G.das.t >= DAS) {
      G.das.arr += dt;
      while (G.das.arr >= ARR) { G.das.arr -= ARR; if (!move(G.das.dir)) break; }
    }
  }
  const nat = gravityInterval(G.level);
  const gi = G.softing ? nat / 20 : nat;   // Guideline soft drop is 20x natural gravity
  G.gTimer += dt;
  while (G.gTimer >= gi) {
    G.gTimer -= gi;
    if (fits(p.kind, p.rot, p.x, p.y + 1)) { p.y++; if (G.softing) G.score += 1; G.lastWasRotate = false; }
    else break;
  }
  G.grounded = !fits(p.kind, p.rot, p.x, p.y + 1);
  if (G.grounded) {
    G.lockT += dt;
    if (G.lockT >= LOCK_DELAY) lockPiece();
  } else { G.lockT = 0; }
}

// ------------------------------ the stacking bot ------------------------------
const WEIGHTS = { height: -0.510066, lines: 0.760666, holes: -0.35663, bumps: -0.184483 };
function colHeights(board) {
  const h = new Array(W).fill(0);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) if (board[y * W + x]) { h[x] = H - y; break; }
  }
  return h;
}
function evaluate(board, cleared, wts) {
  const h = colHeights(board);
  let agg = 0, holes = 0, bumps = 0;
  for (let x = 0; x < W; x++) {
    agg += h[x];
    let seen = false;
    for (let y = 0; y < H; y++) {
      if (board[y * W + x]) seen = true;
      else if (seen) holes++;
    }
    if (x < W - 1) bumps += Math.abs(h[x] - h[x + 1]);
  }
  return wts.height * agg + wts.lines * cleared + wts.holes * holes + wts.bumps * bumps;
}
function simulate(kind, rot, x) {
  if (!fits(kind, rot, x, 0) && !fits(kind, rot, x, 1)) return null;
  let y = 0;
  while (fits(kind, rot, x, y + 1)) y++;
  if (!fits(kind, rot, x, y)) return null;
  const nb = G.board.slice();
  for (const [bx, by] of cellsOf(kind, rot, x, y)) { if (by < 0) return null; nb[by * W + bx] = kind; }
  let cleared = 0;
  for (let yy = 0; yy < H; yy++) {
    let full = true;
    for (let xx = 0; xx < W; xx++) if (!nb[yy * W + xx]) { full = false; break; }
    if (full) cleared++;
  }
  return { board: nb, cleared, y };
}
function bestPlacement(kind, o) {
  o = o || {};
  const wts = o.weights || WEIGHTS;
  const rots = o.noRotate ? [0] : [0, 1, 2, 3];
  let best = null;
  for (const rot of rots) {
    for (let x = -3; x < W + 1; x++) {
      const r = simulate(kind, rot, x);
      if (!r) continue;
      let sc = evaluate(r.board, r.cleared, wts);
      if (o.tetrisHungry) sc += r.cleared === 4 ? 24 : r.cleared > 0 ? -14 : 0;
      if (!best || sc > best.score) best = { rot, x, score: sc };
    }
  }
  return best;
}
// The bot plays through the SAME functions the keyboard calls: rotate, move, hard drop.
function botPlay(o) {
  const p = G.piece;
  if (!p || G.over || G.clearing) return false;
  const plan = bestPlacement(p.kind, o);
  if (!plan) { hardDrop(); return true; }
  for (let i = 0; i < 4 && (G.piece.rot & 3) !== plan.rot; i++) if (!rotate(1)) break;
  for (let i = 0; i < W + 4 && G.piece.x !== plan.x; i++) {
    if (!move(G.piece.x < plan.x ? 1 : -1)) break;
  }
  hardDrop();
  return true;
}
function runStack(o, cap) {
  o = o || {};
  let n = 0;
  while (!G.over && n < cap) {
    if (o.idle) { hardDrop(); }   // the null player: never steers, just drops
    else botPlay(o);
    n++;
  }
  return { survived: n, over: G.over, lines: G.lines, score: G.score, level: G.level, tetrises: G.tetrises };
}

// ------------------------------ verify: stacks as theorems ------------------------------
const RUN_SEED = 19840;
function report(mode, ok, extra) {
  const rep = Object.assign({ mode, outcome: ok }, extra || {});
  const s = 'VERIFY:' + JSON.stringify(rep);
  document.title = s;
  const pre = document.createElement('pre'); pre.textContent = s; document.body.appendChild(pre);
}
function blank() { newGame(1, { headless: true }); G.board.fill(null); return G; }
function setRows(spec) { // spec: array of [y, 'xxx.xxxxxx'] where x = filled
  for (const [y, s] of spec)
    for (let x = 0; x < W; x++) G.board[y * W + x] = s[x] === 'x' ? 'I' : null;
}
// shots only: an authored stack is coloured as a mixed-piece stack would be, and the
// position is flagged so no capture can pass hand-built state off as play
function dress() {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (G.board[i]) G.board[i] = KINDS[Math.floor(hash32(x, y, 3) * 7)];
  }
  G.staged = true;
}
function runVerify(mode) {
  const CAP = 400;
  if (mode === 'solution') {
    newGame(RUN_SEED, { headless: true });
    const r = runStack({}, CAP);
    const pass = !r.over && r.lines > 100;
    report(mode, pass ? 'PASS' : 'FAIL', Object.assign({ claim: 'bot survives 400 pieces, >100 lines', result: r.over ? 'TOPPED-OUT' : 'SURVIVED' }, r));
  } else if (mode === 'solution-seeds') {
    let ok = 0, nul = 0; const rows = [];
    for (let i = 0; i < 10; i++) {
      const sd = RUN_SEED + i * 977;
      newGame(sd, { headless: true });
      const r = runStack({}, CAP);
      if (!r.over) ok++;
      newGame(sd, { headless: true });
      const nr = runStack({ idle: true }, CAP);
      if (!nr.over) nul++;
      rows.push(sd + ':' + (r.over ? 'X' : 'S') + r.lines + ':' + (nr.over ? 'X' : 'S') + nr.survived);
    }
    report(mode, ok === 10 && nul === 0 ? 'PASS' : 'FAIL', { botSurvived: ok, nullSurvived: nul, of: 10, runs: rows.join(' ') });
  } else if (mode === 'null') {
    newGame(RUN_SEED, { headless: true });
    const r = runStack({ idle: true }, CAP);
    report(mode, r.over ? 'PASS' : 'FAIL', Object.assign({ claim: 'a player who never steers must top out', result: r.over ? 'TOPPED-OUT' : 'SURVIVED' }, r));
  } else if (mode === 'ablate-rotation') {
    newGame(RUN_SEED, { headless: true });
    const r = runStack({ noRotate: true }, CAP);
    report(mode, r.over ? 'PASS' : 'FAIL', Object.assign({ claim: 'sliding without rotating must top out', result: r.over ? 'TOPPED-OUT' : 'SURVIVED' }, r));
  } else if (mode === 'ablate-holes') {
    newGame(RUN_SEED, { headless: true });
    const r = runStack({ weights: Object.assign({}, WEIGHTS, { holes: 0 }) }, CAP);
    report(mode, r.over ? 'PASS' : 'FAIL', Object.assign({ claim: 'ignoring buried holes must top out', result: r.over ? 'TOPPED-OUT' : 'SURVIVED' }, r));
  } else if (mode === 'ablate-height') {
    newGame(RUN_SEED, { headless: true });
    const r = runStack({ weights: Object.assign({}, WEIGHTS, { height: 0, bumps: 0 }) }, CAP);
    report(mode, r.over ? 'PASS' : 'FAIL', Object.assign({ claim: 'ignoring height and bumpiness must top out', result: r.over ? 'TOPPED-OUT' : 'SURVIVED' }, r));
  } else if (mode === 'debug-sim') {
    newGame(RUN_SEED, { headless: false });
    simRun(70);
    report(mode, 'INFO', { elapsed: +G.elapsed.toFixed(1), level: G.level, lines: G.lines, pieces: G.pieces, over: G.over });
  } else if (mode === 'mech-bag') {
    newGame(RUN_SEED, { headless: true });
    const seen = [];
    G.queue = [];                       // start on a bag boundary
    while (seen.length < 700) { refill(); seen.push(G.queue.shift()); }
    let ok = true, dupBag = -1;
    for (let i = 0; i + 7 <= 700; i += 7) {
      const set = new Set(seen.slice(i, i + 7));
      if (set.size !== 7) { ok = false; dupBag = i / 7; break; }
    }
    report(mode, ok ? 'PASS' : 'FAIL', { bagsChecked: 100, firstBadBag: dupBag, sample: seen.slice(0, 14).join('') });
  } else if (mode === 'mech-srs') {
    // a J flush against the left wall cannot rotate in place — SRS kicks it inward
    blank();
    G.piece = { kind: 'J', rot: 1, x: -1, y: 5 };
    const naive = fits('J', 0, -1, 5);
    const kicked = rotate(-1);
    const dx = G.piece.x - (-1);
    report(mode, !naive && kicked && dx === 1 && G.lastKick === 1 ? 'PASS' : 'FAIL',
      { naiveRotationFits: naive, kickedRotation: kicked, kickIndex: G.lastKick, dx: dx });
  } else if (mode === 'mech-shapes') {
    // the canonical SRS states, drawn here as grids and compared to the tables the game uses
    const GRID = {
      I: ['....|XXXX|....|....', '..X.|..X.|..X.|..X.', '....|....|XXXX|....', '.X..|.X..|.X..|.X..'],
      J: ['X..|XXX|...', '.XX|.X.|.X.', '...|XXX|..X', '.X.|.X.|XX.'],
      L: ['..X|XXX|...', '.X.|.X.|.XX', '...|XXX|X..', 'XX.|.X.|.X.'],
      O: ['.XX|.XX|...', '.XX|.XX|...', '.XX|.XX|...', '.XX|.XX|...'],
      S: ['.XX|XX.|...', '.X.|.XX|..X', '...|.XX|XX.', 'X..|XX.|.X.'],
      T: ['.X.|XXX|...', '.X.|.XX|.X.', '...|XXX|.X.', '.X.|XX.|.X.'],
      Z: ['XX.|.XX|...', '..X|.XX|.X.', '...|XX.|.XX', '.X.|XX.|X..'],
    };
    let bad = '', checked = 0;
    for (const k of KINDS) for (let r = 0; r < 4; r++) {
      const want = new Set();
      const lines = GRID[k][r].split('|');
      for (let y = 0; y < lines.length; y++)
        for (let x = 0; x < lines[y].length; x++)
          if (lines[y][x] === 'X') want.add(x + ',' + y);
      const got = new Set(SHAPES[k][r].map(c => c[0] + ',' + c[1]));
      checked++;
      if (got.size !== 4 || want.size !== 4) { bad = bad || (k + r + ':size'); continue; }
      for (const cell of want) if (!got.has(cell)) { bad = bad || (k + r + ':' + cell); break; }
    }
    // and no two pieces may share a spawn shape
    const spawns = KINDS.map(k => JSON.stringify(SHAPES[k][0].map(c => c.join(',')).sort()));
    const allDistinct = new Set(spawns).size === 7;
    report(mode, !bad && checked === 28 && allDistinct ? 'PASS' : 'FAIL',
      { statesChecked: checked, firstMismatch: bad || 'none', sevenDistinctSpawns: allDistinct });
  } else if (mode === 'mech-srs-table') {
    // the canonical Guideline tables, typed here y-UP, negated in the comparison.
    const YUP = {
      '01': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
      '10': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
      '12': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
      '21': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
      '23': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
      '32': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
      '30': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
      '03': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    };
    const YUP_I = {
      '01': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
      '10': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
      '12': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
      '21': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
      '23': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
      '32': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
      '30': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
      '03': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    };
    let checked = 0, bad = '';
    const cmp = (mine, canon) => {
      for (const k in canon) {
        for (let i = 0; i < 5; i++) {
          checked++;
          const a = mine[k] && mine[k][i], b = canon[k][i];
          if (!a || a[0] !== b[0] || a[1] !== -b[1]) { bad = bad || (k + '#' + i); }
        }
      }
    };
    cmp(KICK, YUP); cmp(KICK_I, YUP_I);
    // and the two tables must not be the same table
    const distinct = JSON.stringify(KICK) !== JSON.stringify(KICK_I);
    report(mode, !bad && checked === 80 && distinct ? 'PASS' : 'FAIL',
      { offsetsChecked: checked, firstMismatch: bad || 'none', tablesDistinct: distinct });
  } else if (mode === 'mech-srs-i') {
    // a flat I above a one-wide well: the I table's [+1,0] at index 2 slides it in.
    // the JLSTZ table's index 2 for this transition is [-1,-1], so only the real
    // I-table produces this result — the behavioural counterpart to mech-srs-table.
    blank();
    setRows([[21, 'xxxxxx.xxx'], [20, 'xxxxxx.xxx'], [19, 'xxxxxx.xxx'], [18, 'xxxxxx.xxx']]);
    G.piece = { kind: 'I', rot: 0, x: 3, y: 16 };
    const naiveWell = fits('I', 1, 3, 16);
    const kickedWell = rotate(1);
    const wellX = G.piece.x, wellKick = G.lastKick;
    const jl = KICK['01'][2];
    const distinctFromJLSTZ = !(jl[0] === 1 && jl[1] === 0);
    // and a vertical I in a flat field turns back without needing help
    blank();
    G.piece = { kind: 'I', rot: 1, x: 3, y: 5 };
    const freeTurn = rotate(-1) && G.lastKick === 0;
    report(mode, !naiveWell && kickedWell && wellX === 4 && wellKick === 2 && distinctFromJLSTZ && freeTurn ? 'PASS' : 'FAIL',
      { naiveFits: naiveWell, kicked: kickedWell, landedX: wellX, kickIndex: wellKick,
        offsetIsIOnly: distinctFromJLSTZ, freeTurnUsesNoKick: freeTurn });
  } else if (mode === 'mech-lockout') {
    // a piece that finishes entirely inside the two hidden rows is a lock-out
    blank(); G.headless = true;
    // the spawn columns stay clear, so the ONLY thing that can end this game is the
    // lock-out rule itself — delete that rule and the run simply continues.
    const spec = [];
    for (let y = 2; y < H; y++) spec.push([y, 'xxx...xxxx']);
    setRows(spec);
    const spawnFree = fits('T', 0, 3, 1);
    G.piece = { kind: 'O', rot: 0, x: 7, y: 0 };    // rests entirely in the hidden rows
    const restsHidden = !fits('O', 0, 7, 1);
    const wasOver = G.over;
    lockPiece();
    report(mode, spawnFree && restsHidden && !wasOver && G.over === true ? 'PASS' : 'FAIL',
      { spawnWouldHaveBeenLegal: spawnFree, pieceRestsAboveWell: restsHidden, gameOver: G.over });
  } else if (mode === 'mech-nomino-loss') {
    // no rotation, kick or drop may ever destroy part of a piece
    blank();
    let worst = 4;
    for (const k of KINDS) for (let r = 0; r < 4; r++) for (let x = -3; x <= W; x++) {
      if (!fits(k, r, x, 1)) continue;
      blank();
      G.piece = { kind: k, rot: r, x: x, y: 1 };
      hardDrop();
      let n = 0;
      for (let i = 0; i < W * H; i++) if (G.board[i]) n++;
      worst = Math.min(worst, n);
    }
    // the well has a ceiling: no placement whose cells sit above row 0 may ever be legal
    blank();
    let ceilingLeaks = 0, checkedPos = 0;
    for (const k of KINDS) for (let r = 0; r < 4; r++) for (let x = -3; x <= W; x++) {
      for (let y = -4; y <= 0; y++) {
        const cells = cellsOf(k, r, x, y);
        const above = cells.some(c => c[1] < 0);
        if (!above) continue;
        checkedPos++;
        if (fits(k, r, x, y)) ceilingLeaks++;      // a legal placement with a cell outside the well
      }
    }
    // and no rotation, from any legal spot, may push a cell through that ceiling
    let escaped = false;
    for (const k of KINDS) for (let r = 0; r < 4; r++) for (let x = -1; x <= W - 1; x++) for (let y = 0; y <= 2; y++) {
      blank();
      if (!fits(k, r, x, y)) continue;
      G.piece = { kind: k, rot: r, x: x, y: y };
      rotate(1); rotate(1); rotate(-1);
      for (const [bx, by] of cellsOf(G.piece.kind, G.piece.rot, G.piece.x, G.piece.y))
        if (by < 0 || by >= H || bx < 0 || bx >= W) escaped = true;
    }
    report(mode, worst === 4 && ceilingLeaks === 0 && !escaped ? 'PASS' : 'FAIL',
      { fewestMinoesLanded: worst, expected: 4, aboveCeilingPositionsTested: checkedPos,
        illegalPlacementsAllowed: ceilingLeaks, rotationPushedCellOut: escaped });
  } else if (mode === 'mech-spin-scoring') {
    // exact points for every spin row, and the state each leaves behind
    const slot = () => {                       // rebuilds the proven TSD slot
      blank(); G.level = 1;
      setRows([[19, 'xxxx..x...'], [20, 'xxxx...xxx'], [21, 'xxxxx.xxxx']]);
      G.piece = { kind: 'T', rot: 1, x: 3, y: 1 };
      while (fits('T', 1, 3, G.piece.y + 1)) G.piece.y++;
    };
    slot();
    const b0 = G.score; rotate(1); lockPiece();
    const tsd = G.score - b0, b2bAfterTSD = G.b2b;
    // a spin that clears nothing: no points beyond 400, no back-to-back, and the combo dies
    blank(); G.level = 1;
    setRows([[19, 'xxxx..x...'], [20, 'xxxx...x..'], [21, 'xxxxx.x...']]);
    G.combo = 4; G.b2b = false;
    G.piece = { kind: 'T', rot: 1, x: 3, y: 1 };
    while (fits('T', 1, 3, G.piece.y + 1)) G.piece.y++;
    const b1 = G.score; const spun = rotate(1);
    const kind0 = detectTSpin(G.piece);
    lockPiece();
    const zeroPts = G.score - b1, zeroB2B = G.b2b, zeroCombo = G.combo;
    // --- the negative controls: what is NOT a T-spin ---
    // a mini: three corners, but only one of them in front of the T's point
    const miniSlot = (bottomLeft) => {
      blank(); G.level = 1;
      setRows([[19, '...x.x....'], [21, bottomLeft ? '...x......' : '..........']]);
      G.piece = { kind: 'T', rot: 1, x: 3, y: 19 };
    };
    miniSlot(true);
    const b2 = G.score; rotate(1);
    const miniKind = detectTSpin(G.piece);
    lockPiece();
    const miniPts = G.score - b2;
    // two corners is not a spin at all
    miniSlot(false);
    rotate(1);
    const twoCornerKind = detectTSpin(G.piece);
    // and a T that merely fell into the slot never spun
    miniSlot(true);
    G.piece = { kind: 'T', rot: 2, x: 3, y: 1 };
    hardDrop();
    const droppedKind = G.tspins;
    // the decisive control: rotate somewhere legal, then SLIDE into a three-corner hole.
    // the corners are all there; the rotation is not the last thing that happened.
    blank(); G.level = 1;
    setRows([[19, '.....x.x..'], [21, '.....x....']]);
    G.piece = { kind: 'T', rot: 1, x: 7, y: 19 };
    const rotatedOk = rotate(1);                    // now rot 2 at x=7, flag set
    const slid = move(-1) && move(-1);              // walk it into the slot; flag cleared
    const slidCorners = cornersFilled(G.piece).total;
    const slidKind = detectTSpin(G.piece);
    const bs = G.score; lockPiece();
    const slidPts = G.score - bs;
    // holding must not let a rotation flag leak into the next piece (the swap branch)
    blank(); G.headless = true;
    G.piece = { kind: 'T', rot: 0, x: 3, y: 1 };
    holdPiece();                                   // fills the hold, spawns a successor
    hardDrop();                                    // refreshes the privilege
    rotate(1);
    const swapped = holdPiece();                   // now the swap branch runs
    const flagCleared = G.lastWasRotate === false;
    report(mode, tsd === 1200 && b2bAfterTSD === true && spun && kind0 > 0 && zeroPts === 400 &&
      zeroB2B === false && zeroCombo === -1 && miniKind === 1 && miniPts === 100 &&
      twoCornerKind === 0 && droppedKind === 0 && rotatedOk && slid && slidCorners === 3 &&
      slidKind === 0 && slidPts === 0 && swapped && flagCleared ? 'PASS' : 'FAIL',
      { tspinDouble: tsd, armsB2B: b2bAfterTSD, clearlessSpinPoints: zeroPts, expected: 400,
        clearlessArmsB2B: zeroB2B, clearlessCombo: zeroCombo,
        miniIsMini: miniKind === 1, miniPoints: miniPts, twoCornersIsNoSpin: twoCornerKind === 0,
        droppedTIsNoSpin: droppedKind === 0,
        slidIntoCorners: slidCorners, slidIsNoSpin: slidKind === 0, slidPoints: slidPts,
        holdSwapClearsRotateFlag: flagCleared });
  } else if (mode === 'mech-tspin') {
    // the canonical T-spin double: an overhang the T can only reach by spinning under it
    blank(); G.level = 1;
    setRows([[19, 'xxxx..x...'], [20, 'xxxx...xxx'], [21, 'xxxxx.xxxx']]);
    // control: no straight drop, in any column or rotation, can clear these two rows
    let dropCanDouble = false;
    for (let r = 0; r < 4 && !dropCanDouble; r++)
      for (let x = -3; x < W + 1; x++) {
        const s = simulate('T', r, x);
        if (s && s.cleared >= 2) { dropCanDouble = true; break; }
      }
    G.piece = { kind: 'T', rot: 1, x: 3, y: 1 };
    while (fits('T', 1, 3, G.piece.y + 1)) G.piece.y++;   // fall to rest beside the slot
    const restY = G.piece.y;
    const spun = rotate(1);                                // spin down into it
    const kind = detectTSpin(G.piece);
    const before = G.score, linesBefore = G.lines;
    lockPiece();
    const gained = G.score - before, cleared = G.lines - linesBefore;
    report(mode, !dropCanDouble && spun && kind === 2 && cleared === 2 && gained === 1200 ? 'PASS' : 'FAIL',
      { reachableByPlainDrop: dropCanDouble, restedAtRow: restY, kickIndex: G.lastKick,
        spinRecognised: kind === 2, linesCleared: cleared, points: gained, expected: 1200 });
  } else if (mode === 'mech-lock') {
    blank();
    G.headless = false;
    let P = G.piece = { kind: 'O', rot: 0, x: 3, y: 1 };
    while (fits('O', 0, 3, G.piece.y + 1)) G.piece.y++;
    tick(0.3);
    const aliveEarly = G.piece === P;
    move(1); tick(0.3);                    // a move resets the delay
    const aliveAfterReset = G.piece === P;
    tick(0.6);
    const lockedLate = G.piece !== P;
    // the reset budget is finite: infinite shuffling cannot stall the lock forever
    blank(); G.headless = false;
    P = G.piece = { kind: 'O', rot: 0, x: 3, y: 1 };
    while (fits('O', 0, 3, G.piece.y + 1)) G.piece.y++;
    tick(0.01);
    let n = 0;
    for (let i = 0; i < 60 && G.piece === P; i++) { move(i % 2 ? -1 : 1); tick(0.3); n++; }
    const capped = G.piece !== P && n <= LOCK_RESETS + 2;
    report(mode, aliveEarly && aliveAfterReset && lockedLate && capped ? 'PASS' : 'FAIL',
      { survivesHalfDelay: aliveEarly, moveResets: aliveAfterReset, locksEventually: lockedLate, resetCapHolds: capped, movesBeforeLock: n });
  } else if (mode === 'mech-clear') {
    blank();
    setRows([[18, 'x.........'], [19, 'xxxxxxxxx.'], [20, 'xxxxxxxxx.'], [21, 'xxxxxxxxx.']]);
    G.piece = { kind: 'I', rot: 1, x: 7, y: 18 };  // vertical I fills the last column of 3 rows
    G.level = 1;
    const before = G.score;
    hardDrop();
    const marker = G.board[21 * W + 0];            // the lone block must have fallen to the floor
    const rowCount = (() => { let n = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (G.board[y * W + x]) { n++; break; } return n; })();
    report(mode, G.lines === 3 && marker && rowCount === 1 && G.score - before >= 500 ? 'PASS' : 'FAIL',
      { linesCleared: G.lines, blockFellToFloor: !!marker, occupiedRows: rowCount, points: G.score - before });
  } else if (mode === 'mech-score') {
    const one = (rowsFilled, lvl) => {
      blank(); G.level = lvl;
      const spec = [[12, 'x.........']];      // dirt: keeps every case off the perfect-clear path
      for (let i = 0; i < rowsFilled; i++) spec.push([21 - i, 'xxxxxxxxx.']);
      setRows(spec);
      G.piece = { kind: 'I', rot: 1, x: 7, y: 18 };  // already at rest: no hard-drop points
      const before = G.score;
      hardDrop();
      return G.score - before;
    };
    const s1 = one(1, 1), s2 = one(2, 1), s3 = one(3, 1), s4 = one(4, 1), s4L3 = one(4, 3);
    // hard-drop distance also pays
    blank(); const b0 = G.score; G.piece = { kind: 'O', rot: 0, x: 3, y: 1 }; hardDrop();
    const dropPts = G.score - b0;
    const ok = s1 === 100 && s2 === 300 && s3 === 500 && s4 === 800 && s4L3 === 2400 && dropPts === 38;
    report(mode, ok ? 'PASS' : 'FAIL', { single: s1, double: s2, triple: s3, tetris: s4, tetrisAtLevel3: s4L3, hardDropPoints: dropPts });
  } else if (mode === 'mech-b2b') {
    const tetris = () => {
      setRows([[12, 'x.........'],           // dirt, so a tetris is only a tetris
      [18, 'xxxxxxxxx.'], [19, 'xxxxxxxxx.'], [20, 'xxxxxxxxx.'], [21, 'xxxxxxxxx.']]);
      G.piece = { kind: 'I', rot: 1, x: 7, y: 18 };
      const before = G.score; hardDrop(); return G.score - before;
    };
    blank(); G.level = 1;
    const first = tetris();
    const second = tetris();
    setRows([[12, 'x.........'], [21, 'xxxxxxxxx.']]);   // a plain single breaks the chain
    G.piece = { kind: 'I', rot: 1, x: 7, y: 18 }; hardDrop();
    const brokenB2B = G.b2b === false;
    // the second tetris is 1200 (800 x1.5 back-to-back) plus a 50-point combo for the unbroken chain
    report(mode, first === 800 && second === 1250 && brokenB2B ? 'PASS' : 'FAIL',
      { firstTetris: first, secondTetris: second, expected: '1200 b2b + 50 combo', singleBreaksChain: brokenB2B });
  } else if (mode === 'mech-combo') {
    blank(); G.level = 1;
    const pts = [];
    for (let i = 0; i < 3; i++) {
      setRows([[21, 'xxxxxxxxx.']]);
      G.piece = { kind: 'I', rot: 1, x: 7, y: 18 };
      const before = G.score; hardDrop(); pts.push(G.score - before);
    }
    const rising = pts[1] > pts[0] && pts[2] > pts[1];
    const combo = G.combo;
    blank(); G.level = 1; G.combo = 5;
    G.piece = { kind: 'O', rot: 0, x: 3, y: 1 }; hardDrop();   // a clearless lock resets it
    const reset = G.combo === -1;
    report(mode, rising && combo === 2 && reset ? 'PASS' : 'FAIL',
      { points: pts.join('/'), comboAfter3: combo, resetsOnNoClear: reset });
  } else if (mode === 'mech-gravity') {
    const g1 = gravityInterval(1), g5 = gravityInterval(5), g10 = gravityInterval(10), g15 = gravityInterval(15);
    blank(); G.lines = 0; G.level = 1;
    for (let i = 0; i < 25; i++) { setRows([[21, 'xxxxxxxxx.']]); G.piece = { kind: 'I', rot: 1, x: 7, y: 18 }; hardDrop(); }
    const levelled = G.level === 1 + Math.floor(G.lines / 10);
    const monotone = g1 > g5 && g5 > g10 && g10 > g15;
    const exact = Math.abs(g1 - 1) < 1e-9 && Math.abs(g5 - Math.pow(0.772, 4)) < 1e-9;
    report(mode, levelled && monotone && exact ? 'PASS' : 'FAIL',
      { level1: +g1.toFixed(4), level5: +g5.toFixed(4), level10: +g10.toFixed(4), level15: +g15.toFixed(5), lines: G.lines, level: G.level });
  } else if (mode === 'mech-hold') {
    newGame(RUN_SEED, { headless: true });
    const first = G.piece.kind, nextUp = G.queue[0];
    holdPiece();
    const heldFirst = G.hold === first && G.piece.kind === nextUp;
    const secondBlocked = holdPiece() === false;
    hardDrop();                              // locking refreshes the privilege
    const nowActive = G.piece.kind;
    const swapOk = holdPiece() && G.piece.kind === first && G.hold === nowActive;
    report(mode, heldFirst && secondBlocked && swapOk ? 'PASS' : 'FAIL',
      { storesPiece: heldFirst, blockedTwiceInARow: secondBlocked, swapsAfterLock: swapOk });
  } else if (mode === 'mech-ghost') {
    // an independent oracle: the stack top of each column bounds how far the shape may fall.
    // it never calls ghostY() or hardDrop(), so it cannot agree with them by construction.
    const oracle = (kind, rot, x) => {
      let limit = Infinity;
      for (const [cxo, cyo] of SHAPES[kind][rot & 3]) {
        const col = x + cxo;
        if (col < 0 || col >= W) return null;
        let top = H;
        for (let y = 0; y < H; y++) if (G.board[y * W + col]) { top = y; break; }
        limit = Math.min(limit, top - 1 - cyo);
      }
      return limit;
    };
    const CASES = [
      { rows: [[21, 'xxx....xxx'], [20, 'xxx.......']], kind: 'T', rot: 0, x: 3 },
      { rows: [[21, 'xxxxxxxxx.'], [20, 'x.......xx']], kind: 'I', rot: 0, x: 3 },
      { rows: [[21, 'x........x'], [20, 'x........x'], [19, 'x........x']], kind: 'O', rot: 0, x: 4 },
      { rows: [[21, 'xxxx..xxxx'], [20, 'xxxx...xxx'], [19, 'xx.....xxx']], kind: 'S', rot: 1, x: 3 },
      { rows: [[21, 'x.x.x.x.x.']], kind: 'J', rot: 2, x: 2 },
      { rows: [[18, '....xx....'], [21, 'xxx....xxx']], kind: 'L', rot: 3, x: 4 },
      { rows: [], kind: 'Z', rot: 0, x: 0 },
      { rows: [[21, '.........x'], [20, '.........x']], kind: 'I', rot: 1, x: 6 },
    ];
    let bad = -1, checked = 0, detail = '';
    for (let i = 0; i < CASES.length; i++) {
      const c = CASES[i];
      blank(); setRows(c.rows);
      G.piece = { kind: c.kind, rot: c.rot, x: c.x, y: 0 };
      const expect = oracle(c.kind, c.rot, c.x);
      const gy = ghostY();
      hardDrop();
      let topRow = H;
      for (let y = 0; y < H && topRow === H; y++)
        for (let x2 = 0; x2 < W; x2++) if (G.board[y * W + x2] === c.kind) { topRow = y; break; }
      const minCyo = Math.min.apply(null, SHAPES[c.kind][c.rot & 3].map(s => s[1]));
      checked++;
      if (expect === null || gy !== expect || topRow !== expect + minCyo) {
        bad = i; detail = 'ghost=' + gy + ' oracle=' + expect + ' landedTop=' + topRow; break;
      }
    }
    report(mode, bad < 0 ? 'PASS' : 'FAIL', { casesChecked: checked, of: CASES.length, firstBadCase: bad, detail: detail || 'none' });
  } else if (mode === 'mech-topout') {
    blank(); G.headless = true;
    const spec = [];
    for (let y = 0; y <= 3; y++) spec.push([y, 'xxxxxxxxxx']);
    setRows(spec);
    const spawned = spawnNext('T');
    report(mode, !spawned && G.over ? 'PASS' : 'FAIL', { spawnRefused: !spawned, gameOver: G.over });
  } else if (mode === 'mech-perfect') {
    blank(); G.level = 1;
    setRows([[21, 'xxxxxx....'], [20, 'xxxxxx....']]);
    G.piece = { kind: 'O', rot: 0, x: 5, y: 18 };  // fills columns 6,7
    hardDrop();
    G.piece = { kind: 'O', rot: 0, x: 7, y: 18 };  // fills columns 8,9 → board empties
    const before = G.score;
    hardDrop();
    const gained = G.score - before;
    let empty = true;
    for (let i = 0; i < W * H; i++) if (G.board[i]) { empty = false; break; }
    // 300 (double) + 1200 (perfect-clear double) + 4 (two hard-dropped cells); combo 0 pays nothing
    const exact = gained === 1504;
    // and each perfect-clear bonus must be its own constant
    // a single-row perfect clear: a flat I completes the floor and leaves nothing behind
    blank(); G.level = 1;
    setRows([[21, 'xxxxxx....']]);
    G.piece = { kind: 'I', rot: 0, x: 6, y: 1 };
    while (fits('I', 0, 6, G.piece.y + 1)) G.piece.y++;
    const b1 = G.score; hardDrop();
    const p1 = G.score - b1;
    // a four-row perfect clear: a vertical I completes four stacked rows at once
    blank(); G.level = 1;
    setRows([[18, 'xxxxxxxxx.'], [19, 'xxxxxxxxx.'], [20, 'xxxxxxxxx.'], [21, 'xxxxxxxxx.']]);
    G.piece = { kind: 'I', rot: 1, x: 7, y: 1 };
    while (fits('I', 1, 7, G.piece.y + 1)) G.piece.y++;
    const b4 = G.score; hardDrop();
    const p4 = G.score - b4;
    report(mode, empty && exact && p1 === 900 && p4 === 2800 ? 'PASS' : 'FAIL',
      { wellEmptied: empty, points: gained, expectedExact: 1504,
        singlePC: p1, expectedSinglePC: 900, tetrisPC: p4, expectedTetrisPC: 2800 });
  } else {
    report(mode, 'UNKNOWN');
  }
}

// ------------------------------ rendering ------------------------------
const CELL = 30, BX = 490, BY = 54;   // 10x20 well, centred
const LX = 180, LW = 260, RX = 840, RW = 260, RAIL = 654;
// portrait: the 1280x720 scene renders untouched; present() recomposes it upright
const PW = 720, PH = 1280, PSCALE = 1.7;
const PWX = (PW - (W * CELL + 20) * PSCALE) / 2, PWY = 196;
let cv, cx, vx, scene;
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace';

// tinted shades of the canon colours, cached — the block material is built from these
const _shade = {};
function shade(col, f) {
  const key = col + '|' + f;
  if (_shade[key]) return _shade[key];
  const r = parseInt(col.slice(1, 3), 16), g = parseInt(col.slice(3, 5), 16), b = parseInt(col.slice(5, 7), 16);
  const s = 'rgb(' + Math.min(255, Math.round(r * f)) + ',' + Math.min(255, Math.round(g * f)) + ',' + Math.min(255, Math.round(b * f)) + ')';
  _shade[key] = s; return s;
}
const _bodyGrad = {};                              // block-body gradients, keyed by row and lit state

function shakeXY() {
  if (G.shake <= 0 || G.shotMode) return [0, 0];
  const s = G.shake * 7;
  return [(hash32(Math.floor(G.time * 60), 1) - 0.5) * s, (hash32(Math.floor(G.time * 60), 2) - 0.5) * s];
}
function block(px, py, col, alpha, ghost, glow) {
  const a = alpha === undefined ? 1 : alpha;
  if (ghost) {                                    // a filled silhouette survives any tint
    cx.globalAlpha = a * 0.35;
    cx.fillStyle = col;
    cx.fillRect(px + 2, py + 2, CELL - 4, CELL - 4);
    cx.globalAlpha = a;
    cx.strokeStyle = col; cx.lineWidth = 1.5;
    cx.setLineDash([4, 3]);
    cx.strokeRect(px + 2.5, py + 2.5, CELL - 5, CELL - 5);
    cx.setLineDash([]);
    cx.globalAlpha = 1;
    return;
  }
  const lit = glow !== false;                      // active pieces glow; the settled stack is quiet
  cx.save();
  cx.globalAlpha = a;
  cx.fillStyle = shade(col, lit ? 0.42 : 0.30);    // body: solid, colour-tinted, dark enough to hold shape
  cx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
  let g = _bodyGrad[py + '|' + lit];               // py is grid-aligned, so this cache stays tiny
  if (!g) {
    g = cx.createLinearGradient(0, py, 0, py + CELL);
    g.addColorStop(0, 'rgba(255,255,255,' + (lit ? 0.30 : 0.16) + ')');
    g.addColorStop(0.42, 'rgba(255,255,255,0.03)');
    g.addColorStop(1, 'rgba(0,0,0,0.34)');
    _bodyGrad[py + '|' + lit] = g;
  }
  cx.fillStyle = g;
  cx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
  // bevel: a lit top edge and a shaded seat give every cell weight
  cx.fillStyle = shade(col, lit ? 1.35 : 1.05); cx.globalAlpha = a * (lit ? 0.9 : 0.6);
  cx.fillRect(px + 2, py + 2, CELL - 4, 2);
  cx.fillStyle = 'rgba(0,0,0,0.5)';
  cx.fillRect(px + 2, py + CELL - 4, CELL - 4, 2);
  cx.globalAlpha = a;
  if (lit) { cx.shadowColor = col; cx.shadowBlur = 10; }
  cx.strokeStyle = lit ? col : shade(col, 0.82);
  cx.lineWidth = lit ? 2 : 1.5;
  cx.strokeRect(px + 2, py + 2, CELL - 4, CELL - 4);
  cx.restore();
}
function drawStars() {
  // pinprick depth layer — far behind everything, dim enough to never fight the stack
  for (let i = 0; i < 70; i++) {
    const x = hash32(i, 41) * 1280, y = hash32(i, 42) * 700;
    const tw = 0.5 + 0.5 * Math.sin(G.time * (0.4 + hash32(i, 44)) + hash32(i, 45) * 6.28);
    cx.globalAlpha = (0.03 + hash32(i, 43) * 0.09) * (0.6 + 0.4 * tw);
    cx.fillStyle = i % 5 === 0 ? '#9fd8ff' : '#c8dcf2';
    const s = hash32(i, 46) > 0.85 ? 2 : 1;
    cx.fillRect(x, y, s, s);
  }
  cx.globalAlpha = 1;
}
function drawFloor(hy) {
  // a perspective floor the whole scene stands on
  const fg = cx.createLinearGradient(0, hy, 0, 720);
  fg.addColorStop(0, 'rgba(52,110,205,0.10)');
  fg.addColorStop(0.12, 'rgba(30,70,150,0.045)');
  fg.addColorStop(1, 'rgba(10,25,60,0)');
  cx.fillStyle = fg; cx.fillRect(0, hy, 1280, 720 - hy);
  cx.strokeStyle = 'rgba(70,140,235,0.09)'; cx.lineWidth = 1;
  cx.beginPath();
  for (let i = 0; i < 8; i++) {                    // rows rush toward the viewer
    const t = i / 7, y = hy + (720 - hy) * t * t;
    cx.moveTo(0, y + 0.5); cx.lineTo(1280, y + 0.5);
  }
  for (let i = -9; i <= 9; i++) {                  // columns converge on the horizon
    cx.moveTo(640 + i * 26, hy); cx.lineTo(640 + i * 200, 720);
  }
  cx.stroke();
  const hg = cx.createLinearGradient(0, hy - 12, 0, hy + 14);   // horizon line glow
  hg.addColorStop(0, 'rgba(80,170,255,0)');
  hg.addColorStop(0.5, 'rgba(80,170,255,0.12)');
  hg.addColorStop(1, 'rgba(80,170,255,0)');
  cx.fillStyle = hg; cx.fillRect(0, hy - 12, 1280, 26);
}
function drawBackdrop() {
  const g = cx.createLinearGradient(0, 0, 0, 720);
  g.addColorStop(0, '#070a16'); g.addColorStop(0.6, '#03050c'); g.addColorStop(1, '#010206');
  cx.fillStyle = g; cx.fillRect(0, 0, 1280, 720);
  drawStars();
  drawFloor(560);
  // slow drift of wireframe pieces, far behind everything
  for (let i = 0; i < 14; i++) {
    const k = KINDS[Math.floor(hash32(i, 21) * 7)];
    const x = hash32(i, 22) * 1280;
    const y = ((hash32(i, 23) * 760 + G.time * (7 + hash32(i, 24) * 11)) % 820) - 50;
    cx.save();
    cx.translate(x, y); cx.rotate(hash32(i, 26) * 6.28);
    drawMini(k, 0, 0, 0.55 + hash32(i, 27) * 0.5, 0.07 + hash32(i, 25) * 0.05);
    cx.restore();
  }
  // the well sits inside a glow that grows with level and combo
  const heat = Math.min(1, (G.level - 1) / 14 + Math.max(0, G.combo) * 0.06);
  const rg = cx.createRadialGradient(640, 354, 60, 640, 354, 520);
  rg.addColorStop(0, 'rgba(62,180,255,' + (0.10 + 0.14 * heat).toFixed(3) + ')');
  rg.addColorStop(0.5, 'rgba(40,90,190,' + (0.05 + 0.07 * heat).toFixed(3) + ')');
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  cx.fillStyle = rg; cx.fillRect(0, 0, 1280, 720);
  const vg = cx.createRadialGradient(640, 360, 260, 640, 360, 780);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.75)');
  cx.fillStyle = vg; cx.fillRect(0, 0, 1280, 720);
}
function drawWell() {
  const [sx, sy] = shakeXY();
  cx.save(); cx.translate(sx, sy);
  const w = W * CELL, h = (H - HIDDEN) * CELL;
  // danger glow
  const heights = colHeights(G.board);
  const maxH = Math.max.apply(null, heights);
  const danger = Math.max(0, Math.min(1, (maxH - 12) / 6));
  cx.fillStyle = '#04070e'; cx.fillRect(BX, BY, w, h);
  // the chamber has walls: inner edge shading pulls the eye to the centre
  const le = cx.createLinearGradient(BX, 0, BX + 22, 0);
  le.addColorStop(0, 'rgba(20,45,95,0.22)'); le.addColorStop(1, 'rgba(20,45,95,0)');
  cx.fillStyle = le; cx.fillRect(BX, BY, 22, h);
  const re = cx.createLinearGradient(BX + w - 22, 0, BX + w, 0);
  re.addColorStop(0, 'rgba(20,45,95,0)'); re.addColorStop(1, 'rgba(20,45,95,0.22)');
  cx.fillStyle = re; cx.fillRect(BX + w - 22, BY, 22, h);
  // ...and a floor the stack visibly sits on
  const fl = cx.createLinearGradient(0, BY + h - 30, 0, BY + h);
  fl.addColorStop(0, 'rgba(62,150,255,0)'); fl.addColorStop(1, 'rgba(62,150,255,0.13)');
  cx.fillStyle = fl; cx.fillRect(BX, BY + h - 30, w, 30);
  if (danger > 0) {
    const rate = 4 + danger * 12;                  // the alarm quickens as the stack rises
    const p = G.shotMode ? 0.8 : 0.5 + 0.5 * Math.sin(G.time * rate);
    const g = cx.createLinearGradient(0, BY, 0, BY + h * 0.5);
    g.addColorStop(0, 'rgba(255,60,90,' + (0.3 * danger * p).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(255,60,90,0)');
    cx.fillStyle = g; cx.fillRect(BX, BY, w, h * 0.5);
  }
  // the column the active piece will land in
  if (G.piece && !G.clearing) {
    const cols = {};
    for (const [bx] of cellsOf(G.piece.kind, G.piece.rot, G.piece.x, G.piece.y)) cols[bx] = 1;
    cx.fillStyle = 'rgba(255,255,255,0.045)';
    for (const c in cols) cx.fillRect(BX + (+c) * CELL, BY, CELL, h);
  }
  cx.strokeStyle = 'rgba(120,170,240,0.07)'; cx.lineWidth = 1;
  cx.beginPath();
  for (let x = 0; x <= W; x++) { cx.moveTo(BX + x * CELL + 0.5, BY); cx.lineTo(BX + x * CELL + 0.5, BY + h); }
  for (let y = 0; y <= H - HIDDEN; y++) { cx.moveTo(BX, BY + y * CELL + 0.5); cx.lineTo(BX + w, BY + y * CELL + 0.5); }
  cx.stroke();
  cx.strokeStyle = 'rgba(120,170,240,0.16)';       // every fifth row, for counting
  cx.beginPath();
  for (let y = 0; y <= H - HIDDEN; y += 5) { cx.moveTo(BX, BY + y * CELL + 0.5); cx.lineTo(BX + w, BY + y * CELL + 0.5); }
  cx.stroke();
  // the line the danger state actually watches
  const dRow = 8;
  cx.save();
  cx.strokeStyle = 'rgba(255,80,100,' + (0.25 + 0.5 * danger).toFixed(3) + ')';
  cx.lineWidth = 1.5; cx.setLineDash([6, 5]);
  cx.beginPath(); cx.moveTo(BX, BY + dRow * CELL + 0.5); cx.lineTo(BX + w, BY + dRow * CELL + 0.5); cx.stroke();
  cx.setLineDash([]);
  cx.restore();
  // settled blocks
  for (let y = HIDDEN; y < H; y++) {
    const clearing = G.clearing && G.clearing.rows.indexOf(y) >= 0;
    for (let x = 0; x < W; x++) {
      const k = G.board[y * W + x];
      if (!k) continue;
      const px = BX + x * CELL, py = BY + (y - HIDDEN) * CELL;
      if (clearing) {
        const k2 = Math.min(1, G.clearing.t / CLEAR_T);
        const hgt = CELL * (1 - k2 * 0.8), off = (CELL - hgt) / 2;
        cx.save();
        cx.shadowColor = COL[k]; cx.shadowBlur = 26 * (1 - k2 * 0.6);   // colour halo around a white-hot core
        cx.fillStyle = COL[k];
        cx.fillRect(px, py + off, CELL, hgt);
        cx.shadowColor = '#ffffff'; cx.shadowBlur = 10 * (1 - k2);
        cx.fillStyle = '#ffffff';
        cx.globalAlpha = 0.75 + 0.25 * (1 - k2);
        cx.fillRect(px, py + off + hgt * 0.14, CELL, hgt * 0.72);
        cx.restore();
      } else block(px, py, COL[k], 1, false, false);
    }
  }
  // the danger tag rides its line above the stack, on a plate so it always reads
  cx.save();
  const dTagA = 0.5 + 0.5 * danger;
  cx.globalAlpha = dTagA;
  cx.fillStyle = 'rgba(20,4,10,0.78)';
  cx.fillRect(BX + 2, BY + dRow * CELL - 15, 62, 13);
  cx.fillStyle = 'rgba(255,120,140,0.98)';
  cx.font = 'bold 9px ' + MONO; cx.textAlign = 'left';
  cx.letterSpacing = '2px';
  cx.fillText('DANGER', BX + 7, BY + dRow * CELL - 5);
  cx.letterSpacing = '0px';
  cx.restore();
  // clearing rows fire a full-width light streak — the moment should look like light, not jelly
  if (G.clearing) {
    const k2 = Math.min(1, G.clearing.t / CLEAR_T);
    cx.save();
    for (const ry of G.clearing.rows) {
      if (ry < HIDDEN) continue;
      const cyy = BY + (ry - HIDDEN) * CELL + CELL / 2;
      const reach = 8 + 26 * k2;
      const beam = cx.createLinearGradient(BX - reach, 0, BX + w + reach, 0);
      const ba = (0.55 * (1 - k2 * 0.55)).toFixed(3);
      beam.addColorStop(0, 'rgba(255,255,255,0)');
      beam.addColorStop(0.08, 'rgba(255,255,255,' + ba + ')');
      beam.addColorStop(0.92, 'rgba(255,255,255,' + ba + ')');
      beam.addColorStop(1, 'rgba(255,255,255,0)');
      cx.fillStyle = beam;
      const bh = 3 + 5 * (1 - k2);
      cx.fillRect(BX - reach, cyy - bh / 2, w + reach * 2, bh);
    }
    cx.restore();
  }
  // hard-drop streaks
  for (const d of G.drops) {
    const age = G.time - d.t;
    if (age > 0.32) continue;
    const al = (1 - age / 0.32) * 0.5;
    for (const [bx, by] of cellsOf(d.kind, d.rot, d.x, d.y1)) {
      if (by < HIDDEN) continue;
      const px = BX + bx * CELL, py0 = BY + Math.max(0, d.y0 - HIDDEN) * CELL, py1 = BY + (by - HIDDEN) * CELL;
      const g = cx.createLinearGradient(0, py0, 0, py1);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, COL[d.kind]);
      cx.globalAlpha = al; cx.fillStyle = g;
      cx.fillRect(px + 8, py0, CELL - 16, Math.max(0, py1 - py0));
      cx.globalAlpha = 1;
    }
  }
  G.drops = G.drops.filter(d => G.time - d.t <= 0.32);
  // ghost + active piece
  const p = G.piece;
  if (p && !G.clearing) {
    const gy = ghostY();
    for (const [bx, by] of cellsOf(p.kind, p.rot, p.x, gy))
      if (by >= HIDDEN) block(BX + bx * CELL, BY + (by - HIDDEN) * CELL, COL[p.kind], 0.4, true);
    const lockGlow = G.grounded ? 0.4 + 0.6 * Math.min(1, G.lockT / LOCK_DELAY) : 0;
    cx.save();
    if (lockGlow) { cx.shadowColor = '#ffffff'; cx.shadowBlur = 12 * lockGlow; }
    for (const [bx, by] of cellsOf(p.kind, p.rot, p.x, p.y))
      if (by >= HIDDEN) block(BX + bx * CELL, BY + (by - HIDDEN) * CELL, COL[p.kind]);
    cx.restore();
  }
  // line-clear sparks
  for (const f of G.fx) {
    const age = G.time - f.t;
    if (f.pop) {
      if (age > 0.9) continue;
      cx.save();
      cx.globalAlpha = age > 0.6 ? (0.9 - age) / 0.3 : 1;
      cx.fillStyle = f.col; cx.font = 'bold 17px ' + MONO; cx.textAlign = 'center';
      cx.shadowColor = '#000'; cx.shadowBlur = 6;
      cx.fillText(f.pop, BX + f.x * CELL, BY + (f.y - HIDDEN) * CELL + 18 - age * 46);
      cx.restore();
      cx.textAlign = 'left';
      continue;
    }
    if (age > 0.5) continue;
    const al = 1 - age / 0.5;
    const px = BX + f.x * CELL + CELL / 2, py = BY + (f.y - HIDDEN) * CELL + CELL / 2;
    cx.globalAlpha = al * 0.9;
    cx.strokeStyle = f.col; cx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const a = hash32(f.x, f.y, i) * 6.28, d = age * 90 * (0.5 + hash32(f.y, f.x, i));
      cx.beginPath();
      cx.moveTo(px + Math.cos(a) * d * 0.4, py + Math.sin(a) * d * 0.4);
      cx.lineTo(px + Math.cos(a) * d, py + Math.sin(a) * d);
      cx.stroke();
    }
    cx.globalAlpha = 1;
  }
  G.fx = G.fx.filter(f => G.time - f.t <= 0.9);
  // the flash and dust of a piece finding its home
  if (G.lockFx) {
    const age = G.time - G.lockFx.t;
    if (age > 0.14) G.lockFx = null;
    else {
      cx.save();
      cx.globalAlpha = (1 - age / 0.14) * 0.8;
      cx.fillStyle = '#ffffff';
      for (const [bx, by] of G.lockFx.cells)
        if (by >= HIDDEN) cx.fillRect(BX + bx * CELL + 1, BY + (by - HIDDEN) * CELL + 1, CELL - 2, CELL - 2);
      cx.restore();
    }
  }
  for (const d of G.dust) {
    const age = G.time - d.t;
    if (age > 0.4) continue;
    const px = BX + (d.x + d.vx * age) * CELL;
    const py = BY + (d.y - HIDDEN + d.vy * age + 5 * age * age) * CELL;
    if (py < BY) continue;
    cx.globalAlpha = (1 - age / 0.4) * 0.75;
    cx.fillStyle = d.col;
    cx.fillRect(px - 1.5, py - 1.5, 3, 3);
    cx.globalAlpha = 1;
  }
  G.dust = G.dust.filter(d => G.time - d.t <= 0.4);
  // frame: a lit chamber, not a rectangle
  const hot = danger > 0.4;
  cx.save();
  cx.shadowColor = hot ? '#ff5a72' : '#3e9bff'; cx.shadowBlur = 13;
  cx.strokeStyle = hot ? 'rgba(255,110,130,0.95)' : 'rgba(110,175,250,0.85)';
  cx.lineWidth = 2;
  cx.strokeRect(BX - 1.5, BY - 1.5, w + 3, h + 3);
  cx.restore();
  cx.strokeStyle = hot ? 'rgba(255,90,110,0.20)' : 'rgba(62,155,255,0.18)';   // a faded outer echo
  cx.lineWidth = 1;
  cx.strokeRect(BX - 6.5, BY - 6.5, w + 13, h + 13);
  cx.strokeStyle = hot ? 'rgba(255,170,185,0.95)' : 'rgba(190,225,255,0.9)';  // corner brackets
  cx.lineWidth = 2;
  cx.beginPath();
  const cl = 14;
  cx.moveTo(BX - 6, BY - 6 + cl); cx.lineTo(BX - 6, BY - 6); cx.lineTo(BX - 6 + cl, BY - 6);
  cx.moveTo(BX + w + 6 - cl, BY - 6); cx.lineTo(BX + w + 6, BY - 6); cx.lineTo(BX + w + 6, BY - 6 + cl);
  cx.moveTo(BX - 6, BY + h + 6 - cl); cx.lineTo(BX - 6, BY + h + 6); cx.lineTo(BX - 6 + cl, BY + h + 6);
  cx.moveTo(BX + w + 6 - cl, BY + h + 6); cx.lineTo(BX + w + 6, BY + h + 6); cx.lineTo(BX + w + 6, BY + h + 6 - cl);
  cx.stroke();
  cx.restore();
}
function drawMini(kind, cxp, cyp, scale, alpha) {
  if (!kind) return;
  const s = CELL * (scale || 0.7);
  const cells = SHAPES[kind][0];
  let minx = 9, maxx = -9, miny = 9, maxy = -9;
  for (const [x, y] of cells) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
  const w = (maxx - minx + 1) * s, h = (maxy - miny + 1) * s;
  const ox = cxp - w / 2 - minx * s, oy = cyp - h / 2 - miny * s;
  for (const [x, y] of cells) {
    const px = ox + x * s, py = oy + y * s;
    cx.globalAlpha = alpha === undefined ? 1 : alpha;
    cx.fillStyle = shade(COL[kind], 0.30); cx.fillRect(px + 1, py + 1, s - 2, s - 2);
    cx.fillStyle = shade(COL[kind], 1.3); cx.globalAlpha = (alpha === undefined ? 1 : alpha) * 0.5;
    cx.fillRect(px + 2, py + 2, s - 4, 1.5);
    cx.globalAlpha = alpha === undefined ? 1 : alpha;
    cx.strokeStyle = COL[kind]; cx.lineWidth = 1.6;
    cx.strokeRect(px + 2, py + 2, s - 4, s - 4);
    cx.globalAlpha = 1;
  }
}
function panelBox(x, y, w, h, title, accent) {
  const g = cx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, 'rgba(12,20,38,0.94)');
  g.addColorStop(1, 'rgba(5,9,18,0.94)');
  cx.fillStyle = g; cx.fillRect(x, y, w, h);
  cx.fillStyle = 'rgba(130,190,255,0.12)';         // a lit top edge gives the plate a face
  cx.fillRect(x + 1, y + 1, w - 2, 1);
  cx.strokeStyle = 'rgba(60,100,160,0.45)'; cx.lineWidth = 1;
  cx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  if (title) {
    cx.fillStyle = accent || '#3e9bff'; cx.globalAlpha = 0.9;
    cx.fillRect(x + 8, y + 7, 3, 9);               // accent tick names the panel's colour
    cx.globalAlpha = 1;
    cx.fillStyle = '#7f9dc0'; cx.font = 'bold 10px ' + MONO; cx.textAlign = 'left';
    cx.letterSpacing = '2px';
    cx.fillText(title, x + 17, y + 15);
    cx.letterSpacing = '0px';
  }
}
function fmtTime(t) {
  const tenths = Math.round(t * 10);
  const m = Math.floor(tenths / 600), s = (tenths - m * 600) / 10;
  const ss = s.toFixed(1);
  return m + ':' + (s < 10 ? '0' : '') + ss;
}
function drawHUD() {
  cx.textAlign = 'left';
  // ---- hold, with an honest locked state ----
  panelBox(LX, BY, LW, 120, TOUCH ? 'HOLD  [swipe ↑]' : 'HOLD  [C]', '#b23dff');
  if (G.hold) {
    drawMini(G.hold, LX + LW / 2, BY + 72, 0.66, G.holdUsed ? 0.28 : 1);
    if (G.holdUsed) {
      cx.fillStyle = '#5d7c9e'; cx.font = 'bold 9px ' + MONO; cx.textAlign = 'center';
      cx.fillText('LOCKED UNTIL DROP', LX + LW / 2, BY + 112); cx.textAlign = 'left';
    }
  } else {
    cx.fillStyle = '#2b3c54'; cx.font = '11px ' + MONO; cx.textAlign = 'center';
    cx.fillText('empty', LX + LW / 2, BY + 76); cx.textAlign = 'left';
  }
  // ---- score, dominant ----
  panelBox(LX, BY + 132, LW, 286, 'PROGRESS', '#3ef0ff');
  cx.save();
  cx.shadowColor = '#3ef0ff'; cx.shadowBlur = 22;
  cx.fillStyle = '#5ee8ff'; cx.font = 'bold 34px ' + MONO; cx.textAlign = 'right';
  cx.fillText(String(Math.floor(G.shownScore)), LX + LW - 14, BY + 176);
  cx.shadowBlur = 4; cx.fillStyle = '#eafcff';
  cx.fillText(String(Math.floor(G.shownScore)), LX + LW - 14, BY + 176);
  cx.restore();
  cx.fillStyle = '#5d7c9e'; cx.font = '9px ' + MONO; cx.textAlign = 'left';
  cx.fillText('SCORE', LX + 14, BY + 176);
  const rows = [['LINES', String(G.lines)], ['LEVEL', String(G.level)], ['PIECES', String(G.pieces)],
  ['TETRIS', String(G.tetrises)], ['T-SPIN', String(G.tspins)]];
  let ry = BY + 210;
  for (const [k, v] of rows) {
    cx.fillStyle = '#5d7c9e'; cx.font = '10px ' + MONO; cx.textAlign = 'left';
    cx.fillText(k, LX + 14, ry);
    cx.fillStyle = v === '0' ? '#5d7c9e' : '#cfe6ff';
    cx.font = '13px ' + MONO; cx.textAlign = 'right';
    cx.fillText(v, LX + LW - 14, ry);
    ry += 30;
  }
  const into = G.lines % 10;
  cx.fillStyle = '#0d1626'; cx.fillRect(LX + 14, BY + 372, LW - 28, 7);
  const bw2 = (LW - 28) * (into / 10);
  if (bw2 > 0) {
    const bg2 = cx.createLinearGradient(LX + 14, 0, LX + 14 + bw2, 0);
    bg2.addColorStop(0, '#1a7f97'); bg2.addColorStop(1, '#3ef0ff');
    cx.fillStyle = bg2; cx.fillRect(LX + 14, BY + 372, bw2, 7);
    cx.save(); cx.shadowColor = '#3ef0ff'; cx.shadowBlur = 8;
    cx.fillStyle = '#bff8ff'; cx.fillRect(LX + 12 + bw2, BY + 371, 2, 9);
    cx.restore();
  }
  cx.fillStyle = '#7f9dc0'; cx.font = '10px ' + MONO; cx.textAlign = 'left';
  cx.fillText((10 - into) + ' LINES TO LEVEL ' + (G.level + 1), LX + 14, BY + 396);
  // ---- streak: always reserved, never reflows ----
  panelBox(LX, BY + 430, LW, 72, 'STREAK', '#ffe14a');
  cx.font = 'bold 12px ' + MONO;
  cx.fillStyle = G.combo > 0 ? '#ffe14a' : '#243449';
  cx.fillText(G.combo > 0 ? G.combo + ' COMBO' : 'no combo', LX + 14, BY + 460);
  cx.fillStyle = G.b2b ? '#b23dff' : '#243449';
  cx.fillText(G.b2b ? 'BACK-TO-BACK ARMED' : 'no back-to-back', LX + 14, BY + 484);
  // ---- the clock that makes PIECES mean something ----
  panelBox(LX, BY + 514, LW, RAIL - (BY + 514), 'RUN', '#3eff6e');
  const el = G.elapsed;
  const timed = el >= 0.5;
  const stats = timed
    ? [['TIME', fmtTime(el)], ['PPS', (G.pieces / el).toFixed(2)], ['LPM', (G.lines / el * 60).toFixed(1)]]
    : [['TIME', '\u2014'], ['PPS', '\u2014'], ['LPM', '\u2014']];
  let tx = LX + 14;
  for (const [k, v] of stats) {
    cx.fillStyle = '#5d7c9e'; cx.font = '9px ' + MONO; cx.textAlign = 'left';
    cx.fillText(k, tx, BY + 542);
    cx.fillStyle = '#cfe6ff'; cx.font = 'bold 13px ' + MONO;
    cx.fillText(v, tx, BY + 562);
    tx += 84;
  }
  // ---- next ----
  panelBox(RX, BY, RW, 360, 'NEXT', '#3ef0ff');
  for (let i = 0; i < 5 && i < G.queue.length; i++) {
    if (i === 0) {
      cx.fillStyle = 'rgba(62,240,255,0.06)'; cx.fillRect(RX + 8, BY + 24, RW - 16, 74);
      cx.strokeStyle = 'rgba(62,240,255,0.3)'; cx.strokeRect(RX + 8.5, BY + 24.5, RW - 17, 73);
    }
    drawMini(G.queue[i], RX + RW / 2, BY + (i === 0 ? 61 : 61 + 22 + i * 62), i === 0 ? 0.72 : 0.5, i === 0 ? 1 : 0.62 - i * 0.07);
  }
  // ---- controls ----
  panelBox(RX, BY + 372, RW, RAIL - (BY + 372), 'CONTROLS', '#2a4a72');
  const help = TOUCH
    ? [['drag \u2190\u2192', 'move'], ['drag \u2193', 'soft drop'], ['flick \u2193', 'hard drop'],
    ['tap', 'rotate CW'], ['tap left \u2153', 'rotate CCW'], ['swipe \u2191', 'hold']]
    : [['\u2190 \u2192', 'move'], ['\u2193', 'soft drop'], ['SPACE', 'hard drop'], ['\u2191 / X', 'rotate CW'],
    ['Z', 'rotate CCW'], ['C', 'hold'], ['P', 'pause'], ['R', 'restart'], ['M', 'mute' + (G.muted ? ' (ON)' : '')]];
  let hy = BY + 396;
  for (const [k, v] of help) {
    cx.fillStyle = '#4f89b8'; cx.font = 'bold 10px ' + MONO; cx.textAlign = 'right';
    cx.fillText(k, RX + 72, hy);
    cx.fillStyle = '#43587a'; cx.font = '10px ' + MONO; cx.textAlign = 'left';
    cx.fillText(v, RX + 84, hy);
    hy += 22;
  }
  cx.textAlign = 'left';
}
function drawBanner() {
  const b = G.banner;
  if (!b) return;
  const age = G.time - b.t;
  const life = b.big ? 1.9 : 0.9;
  if (age > life) { G.banner = null; return; }
  const grow = Math.min(1, age * (b.big ? 5 : 9));
  const al = age > life - 0.4 ? (life - age) / 0.4 : 1;
  const label = b.txt + (b.pts ? '   +' + b.pts : '');
  const cxx = BX + W * CELL / 2, cyy = BY + 62;
  cx.save();
  cx.globalAlpha = al;
  let fs = Math.round((b.big ? 15 : 11) + (b.big ? 17 : 7) * grow);
  const maxW = W * CELL - 14;
  do { cx.font = 'bold ' + fs + 'px ' + MONO; fs -= 1; } while (cx.measureText(label).width > maxW && fs > 8);
  const tw = cx.measureText(label).width;
  const plate = cx.createLinearGradient(cxx - tw, 0, cxx + tw, 0);   // a plate, so the stack never wins
  plate.addColorStop(0, 'rgba(4,7,14,0)');
  plate.addColorStop(0.5, 'rgba(4,7,14,0.92)');
  plate.addColorStop(1, 'rgba(4,7,14,0)');
  cx.fillStyle = plate;
  cx.fillRect(cxx - tw, cyy - 24, tw * 2, 40);
  cx.shadowColor = b.col; cx.shadowBlur = b.big ? 24 : 10;
  cx.fillStyle = b.col;
  cx.textAlign = 'center';
  cx.fillText(label, cxx, cyy);
  if (b.big) {                                    // a shockwave for the moments that deserve one
    const r = 40 + age * 620;
    const fade = Math.max(0, 1 - age / 0.55);
    cx.shadowColor = b.col; cx.shadowBlur = 18 * fade;
    cx.globalAlpha = al * fade;
    cx.strokeStyle = b.col; cx.lineWidth = Math.max(1, 11 - age * 18);
    cx.beginPath(); cx.arc(cxx, BY + 300, r, 0, 7); cx.stroke();
    cx.globalAlpha = al * fade * 0.45;             // a trailing echo ring
    cx.lineWidth = 2;
    cx.beginPath(); cx.arc(cxx, BY + 300, r * 0.68, 0, 7); cx.stroke();
    cx.shadowBlur = 0;
    cx.globalAlpha = al * fade * 0.8;              // radial burst rays
    cx.lineWidth = 1.5;
    cx.beginPath();
    for (let i = 0; i < 12; i++) {
      const ra = i / 12 * 6.283 + 0.26;
      const r0 = r * 0.72, r1 = r0 + 14 + r * 0.16;
      cx.moveTo(cxx + Math.cos(ra) * r0, BY + 300 + Math.sin(ra) * r0);
      cx.lineTo(cxx + Math.cos(ra) * r1, BY + 300 + Math.sin(ra) * r1);
    }
    cx.stroke();
  }
  cx.restore();
  cx.textAlign = 'left';
}
function drawTitle() {
  const bg = cx.createLinearGradient(0, 0, 0, 720);
  bg.addColorStop(0, '#060a18'); bg.addColorStop(0.65, '#02040a'); bg.addColorStop(1, '#010206');
  cx.fillStyle = bg; cx.fillRect(0, 0, 1280, 720);
  drawStars();
  drawFloor(592);
  // drifting tetrominoes
  const kinds = KINDS;
  for (let i = 0; i < 22; i++) {
    const k = kinds[Math.floor(hash32(i, 9) * 7)];
    const x = hash32(i, 1) * 1280;
    const speed = 18 + hash32(i, 2) * 26;
    const y = ((hash32(i, 3) * 720 + G.time * speed) % 800) - 40;
    cx.save();
    cx.translate(x, y); cx.rotate(hash32(i, 5) * 6.28);
    drawMini(k, 0, 0, 0.5 + hash32(i, 6) * 0.4, 0.12 + hash32(i, 4) * 0.16);
    cx.restore();
  }
  // a scrim so the drift never eats the wordmark
  const scrim = cx.createRadialGradient(640, 370, 40, 640, 370, 470);
  scrim.addColorStop(0, 'rgba(2,4,10,0.96)');
  scrim.addColorStop(0.55, 'rgba(2,4,10,0.82)');
  scrim.addColorStop(1, 'rgba(2,4,10,0)');
  cx.fillStyle = scrim; cx.fillRect(0, 0, 1280, 720);
  cx.textAlign = 'center';
  // the wordmark: chromatic ghosts under a gradient face under a hot core
  cx.save();
  cx.font = 'bold 84px ' + MONO;
  cx.letterSpacing = '6px';
  cx.globalAlpha = 0.4;
  cx.fillStyle = '#ff3355'; cx.fillText('NEOTRIS', 636, 297);
  cx.fillStyle = '#b23dff'; cx.fillText('NEOTRIS', 644, 303);
  cx.globalAlpha = 1;
  cx.shadowColor = '#3ef0ff'; cx.shadowBlur = 34;
  const wm = cx.createLinearGradient(0, 232, 0, 302);
  wm.addColorStop(0, '#f2ffff'); wm.addColorStop(0.55, '#9df2ff'); wm.addColorStop(1, '#3ecbe8');
  cx.fillStyle = wm; cx.fillText('NEOTRIS', 640, 300);
  cx.shadowBlur = 8; cx.fillStyle = 'rgba(255,255,255,0.55)';
  cx.fillText('NEOTRIS', 640, 300);
  cx.restore();
  cx.letterSpacing = '0px';
  // an energy rule under the name, bright at the centre
  const rule = cx.createLinearGradient(340, 0, 940, 0);
  rule.addColorStop(0, 'rgba(62,240,255,0)');
  rule.addColorStop(0.5, 'rgba(62,240,255,0.85)');
  rule.addColorStop(1, 'rgba(62,240,255,0)');
  cx.save();
  cx.shadowColor = '#3ef0ff'; cx.shadowBlur = 10;
  cx.fillStyle = rule; cx.fillRect(340, 326, 600, 2);
  cx.restore();
  // a row of the seven pieces, in canon colours
  for (let i = 0; i < 7; i++) drawMini(KINDS[i], 340 + i * 100, 388, 0.5);
  cx.fillStyle = '#7f9dc0'; cx.font = '14px ' + MONO;
  cx.letterSpacing = '1px';
  cx.fillText('seven pieces, one well, no mercy — a Tetris tribute', 640, 452);
  cx.letterSpacing = '0px';
  if (!G.shotMode) {
    const pulse = 0.72 + 0.28 * Math.sin(G.time * 2.6);
    cx.save();
    cx.globalAlpha = pulse;
    cx.shadowColor = '#3ef0ff'; cx.shadowBlur = 12;
    cx.fillStyle = '#e6f8ff'; cx.font = 'bold 16px ' + MONO;
    cx.letterSpacing = '3px';
    cx.fillText(TOUCH ? 'TAP TO START' : 'PRESS SPACE', 640, 528);
    cx.restore();
    cx.letterSpacing = '0px';
    cx.fillStyle = '#4e6a8c'; cx.font = '12px ' + MONO;
    cx.fillText(TOUCH ? 'drag move · drag ↓ soft · flick ↓ hard drop · tap rotate · swipe ↑ hold'
      : '←→ move · ↓ soft · SPACE hard drop · ↑/X/Z rotate · C hold', 640, 562);
  }
  cx.textAlign = 'left';
}
function drawOver() {
  cx.fillStyle = 'rgba(2,5,10,0.88)'; cx.fillRect(0, 0, 1280, 720);
  cx.textAlign = 'center';
  cx.save();
  cx.shadowColor = '#ff4a6e'; cx.shadowBlur = 34;
  cx.font = 'bold 58px ' + MONO; cx.letterSpacing = '3px';
  cx.fillStyle = '#ff8a9d';
  cx.fillText('THE WELL IS FULL', 640, 286);
  cx.shadowBlur = 6; cx.fillStyle = '#ffd9e0';
  cx.fillText('THE WELL IS FULL', 640, 286);
  cx.restore();
  cx.letterSpacing = '0px';
  cx.save();
  cx.shadowColor = '#3ef0ff'; cx.shadowBlur = 18;
  cx.fillStyle = '#7ff4ff'; cx.font = 'bold 40px ' + MONO;
  cx.fillText(G.score.toLocaleString(), 640, 350);
  cx.restore();
  cx.fillStyle = '#5d7c9e'; cx.font = '11px ' + MONO;
  cx.fillText('POINTS', 640, 372);
  cx.fillStyle = '#8fa8c8'; cx.font = '14px ' + MONO;
  cx.fillText(G.lines + ' LINES  \u00b7  LEVEL ' + G.level + '  \u00b7  ' + G.pieces + ' PIECES  \u00b7  ' +
    G.tetrises + ' TETRISES  \u00b7  ' + G.tspins + ' T-SPINS', 640, 404);
  if (G.elapsed >= 0.5) {
    cx.fillStyle = '#5d7c9e'; cx.font = '12px ' + MONO;
    cx.fillText(fmtTime(G.elapsed) + '  \u00b7  ' + (G.pieces / G.elapsed).toFixed(2) + ' PPS', 640, 430);
  }
  const bw = 300, bx0 = 640 - bw / 2;
  cx.strokeStyle = '#3ef0ff'; cx.lineWidth = 1.5;
  cx.strokeRect(bx0 + 0.5, 466.5, bw, 38);
  cx.fillStyle = '#3ef0ff'; cx.font = 'bold 13px ' + MONO;
  cx.fillText(TOUCH ? 'TAP FOR A FRESH WELL' : '[SPACE] A FRESH WELL', 640, 491);
  cx.textAlign = 'left';
}
function drawPaused() {
  cx.fillStyle = 'rgba(2,5,10,0.8)'; cx.fillRect(BX - 2, BY - 2, W * CELL + 4, (H - HIDDEN) * CELL + 4);
  cx.textAlign = 'center';
  cx.fillStyle = '#3ef0ff'; cx.font = 'bold 30px ' + MONO;
  cx.fillText('PAUSED', BX + W * CELL / 2, BY + 290);
  cx.fillStyle = '#6f8fb8'; cx.font = '12px ' + MONO;
  cx.fillText('[P] resume', BX + W * CELL / 2, BY + 320);
  cx.textAlign = 'left';
}
function draw() {
  if (!cv) return;
  cx.fillStyle = '#02040a'; cx.fillRect(0, 0, 1280, 720);
  if (G.screen === 'title') { drawTitle(); present(); return; }
  drawBackdrop();
  drawWell();
  drawHUD();
  drawBanner();
  if (G.staged && G.shotMode) {
    cx.save();
    cx.fillStyle = '#ffd34a'; cx.globalAlpha = 0.75;
    cx.font = 'bold 11px ' + MONO; cx.textAlign = 'center';
    cx.fillText('STAGED POSITION \u2014 hand-built board, not bot play', 640, 706);
    cx.restore();
    cx.textAlign = 'left';
  }
  if (G.screen === 'paused') drawPaused();
  if (G.screen === 'over') drawOver();
  present();
}
// the scene canvas is landscape; a phone held upright gets the well scaled up
// plus a compact HUD strip, all recomposed from the same untouched frame
function fit() {
  const portrait = window.innerHeight > window.innerWidth;
  const w = portrait ? PW : 1280, h = portrait ? PH : 720;
  if (cv.width !== w) { cv.width = w; cv.height = h; }
}
function present() {
  if (cv.width !== PW) { vx.drawImage(scene, 0, 0); return; }
  vx.fillStyle = '#02040a'; vx.fillRect(0, 0, PW, PH);
  if (G.screen === 'title' || G.screen === 'over') {
    vx.drawImage(scene, 280, 0, 720, 720, 0, (PH - 720) / 2, 720, 720);
    return;
  }
  const ww = W * CELL + 20, wh = (H - HIDDEN) * CELL + 20;
  vx.drawImage(scene, BX - 10, BY - 10, ww, wh, PWX, PWY, ww * PSCALE, wh * PSCALE);
  drawPortraitHUD();
}
function drawPortraitHUD() {
  const pg = vx.createLinearGradient(0, 0, 0, 168);
  pg.addColorStop(0, 'rgba(12,20,38,0.9)');
  pg.addColorStop(1, 'rgba(2,4,10,0)');
  vx.fillStyle = pg; vx.fillRect(0, 0, PW, 168);
  vx.fillStyle = 'rgba(80,150,230,0.25)'; vx.fillRect(0, 166, PW, 1);
  vx.save();
  vx.shadowColor = '#3ef0ff'; vx.shadowBlur = 18;
  vx.fillStyle = '#5ee8ff'; vx.font = 'bold 46px ' + MONO; vx.textAlign = 'left';
  vx.fillText(String(Math.floor(G.shownScore)), 26, 92);
  vx.shadowBlur = 4; vx.fillStyle = '#eafcff';
  vx.fillText(String(Math.floor(G.shownScore)), 26, 92);
  vx.restore();
  vx.fillStyle = '#5d7c9e'; vx.font = 'bold 14px ' + MONO; vx.textAlign = 'left';
  vx.letterSpacing = '2px';
  vx.fillText('SCORE', 26, 40);
  vx.fillText('HOLD', 400, 40);
  vx.fillText('NEXT', 545, 40);
  vx.letterSpacing = '0px';
  vx.fillStyle = '#8fa8c8'; vx.font = '17px ' + MONO;
  vx.fillText('LINES ' + G.lines + '   LEVEL ' + G.level, 26, 140);
  const oc = cx; cx = vx;                        // drawMini paints through cx
  if (G.hold) drawMini(G.hold, 428, 95, 0.62, G.holdUsed ? 0.28 : 1);
  if (G.queue[0]) drawMini(G.queue[0], 578, 95, 0.78);
  if (G.queue[1]) drawMini(G.queue[1], 668, 95, 0.5, 0.6);
  cx = oc;
}

// ------------------------------ audio ------------------------------
let AC = null;
function beep(f, d, type, delay) {
  if (!G || G.muted || G.headless || G.shotMode) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = AC.currentTime + (delay || 0);
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type || 'square'; o.frequency.value = f;
    g.gain.setValueAtTime(type === 'sine' ? 0.16 : 0.05, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + d);
    o.connect(g); g.connect(AC.destination);
    o.start(t0); o.stop(t0 + d);
  } catch (e) { }
}
// mobile browsers gate audio behind a user gesture: create/resume on the first one
function unlockAudio() {
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === 'suspended') AC.resume();
  } catch (e) { }
}

// ------------------------------ input ------------------------------
function onKey(e) {
  unlockAudio();
  const k = e.key;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].indexOf(k) >= 0) e.preventDefault();
  if (G.screen === 'title') {
    if (k === ' ' || k === 'Enter') { newGame(URLSEED); beep(440, 0.1); }
    return;
  }
  if (G.screen === 'over') {
    if (k === ' ' || k === 'Enter') { newGame(G.seed + 1); beep(440, 0.1); }
    return;
  }
  if (k === 'p' || k === 'P') { G.screen = G.screen === 'paused' ? 'play' : 'paused'; return; }
  if (k === 'r' || k === 'R') { const b = G.best; newGame(G.seed + 1); G.best = b; beep(440, 0.1); return; }
  if (k === 'm' || k === 'M') { G.muted = !G.muted; return; }
  if (G.screen === 'paused') return;
  switch (k) {
    case 'ArrowLeft': if (G.das.dir !== -1) { G.das = { dir: -1, t: 0, arr: 0 }; if (move(-1)) beep(200, 0.02); } break;
    case 'ArrowRight': if (G.das.dir !== 1) { G.das = { dir: 1, t: 0, arr: 0 }; if (move(1)) beep(200, 0.02); } break;
    case 'ArrowDown': G.softing = true; break;
    case 'ArrowUp': case 'x': case 'X': if (rotate(1)) beep(300, 0.03); break;
    case 'z': case 'Z': if (rotate(-1)) beep(300, 0.03); break;
    case ' ': hardDrop(); beep(150, 0.06); break;
    case 'c': case 'C': if (holdPiece()) beep(420, 0.04); break;
  }
}
function onKeyUp(e) {
  if (!G) return;
  const k = e.key;
  if (k === 'ArrowLeft' && G.das.dir === -1) G.das.dir = 0;
  if (k === 'ArrowRight' && G.das.dir === 1) G.das.dir = 0;
  if (k === 'ArrowDown') G.softing = false;
}

// ------------------------------ touch ------------------------------
// gestures land on the same actions the keyboard calls: drag = move,
// drag down = soft drop, flick down = hard drop, swipe up = hold,
// tap = rotate CW (tap in the left third = CCW)
const TOUCH = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
let TS = null;
function cellPx() {                                // one well cell, in screen pixels
  const r = cv.getBoundingClientRect();
  return CELL * (cv.width === PW ? PSCALE : 1) * (r.width / cv.width);
}
function touchBy(e, id) {
  for (let i = 0; i < e.changedTouches.length; i++)
    if (e.changedTouches[i].identifier === id) return e.changedTouches[i];
  return null;
}
function onTouchStart(e) {
  e.preventDefault();
  unlockAudio();
  if (G.screen === 'title') { newGame(URLSEED); beep(440, 0.1); return; }
  if (G.screen === 'over') {                       // a beat, so taps cannot skip the score
    if (Date.now() - overAt > 500) { newGame(G.seed + 1); beep(440, 0.1); }
    return;
  }
  if (TS) return;                                  // one steering finger at a time
  const t = e.changedTouches[0];
  TS = { id: t.identifier, x0: t.clientX, y0: t.clientY, t0: performance.now(), mode: '', steps: 0 };
}
function onTouchMove(e) {
  e.preventDefault();
  if (!TS || G.screen !== 'play') return;
  const t = touchBy(e, TS.id);
  if (!t) return;
  const c = cellPx(), dx = t.clientX - TS.x0, dy = t.clientY - TS.y0;
  if (!TS.mode) {
    if (Math.abs(dx) > c * 0.55 && Math.abs(dx) > Math.abs(dy)) TS.mode = 'h';
    else if (dy > c * 0.55 && dy > Math.abs(dx)) TS.mode = 'v';
    else if (dy < -c * 1.1) TS.mode = 'u';
  }
  if (TS.mode === 'h') {                           // one cell per cell-width dragged
    const want = Math.round(dx / c);
    while (TS.steps < want) { if (!move(1)) break; TS.steps++; beep(200, 0.02); }
    while (TS.steps > want) { if (!move(-1)) break; TS.steps--; beep(200, 0.02); }
  } else if (TS.mode === 'v') {
    const want = Math.round(dy / c);
    while (TS.steps < want) { if (!softDrop()) break; TS.steps++; }
  }
}
function onTouchEnd(e) {
  e.preventDefault();
  if (!TS) return;
  const t = touchBy(e, TS.id);
  if (!t) return;
  const s = TS; TS = null;
  if (G.screen !== 'play') return;
  const c = cellPx(), dx = t.clientX - s.x0, dy = t.clientY - s.y0;
  const dt = performance.now() - s.t0;
  if (!s.mode && dt < 300 && Math.abs(dx) < c * 0.5 && Math.abs(dy) < c * 0.5) {
    const r = cv.getBoundingClientRect();
    if (rotate(t.clientX - r.left < r.width / 3 ? -1 : 1)) beep(300, 0.03);
  } else if (s.mode === 'v' && dt < 260 && dy > c * 1.6) { hardDrop(); beep(150, 0.06); }
  else if (s.mode === 'u' && dy < -c) { if (holdPiece()) beep(420, 0.04); }
}

// ------------------------------ shots ------------------------------
// plays through tick() at a true 60Hz, so TIME/PPS/LPM are measured, not invented
function simRun(seconds, o, every) {
  const dt = 1 / 60;
  const steps = Math.round(seconds / dt);
  const gap = every || 30;              // a human-plausible cadence, not a machine's
  for (let i = 0; i < steps && !G.over; i++) {
    if (G.piece && !G.clearing && i % gap === 0) botPlay(o || {});
    tick(dt);
  }
}
function playTo(pred, o, cap) {
  for (let i = 0; i < (cap || 400) && !G.over; i++) {
    botPlay(o || {});
    if (pred && pred()) return true;
  }
  return false;
}
const SHOTS = {
  title: { run() { newGame(RUN_SEED); G.screen = 'title'; }, check() { return true; } },
  play: {
    run() {
      newGame(RUN_SEED, { headless: true });
      playTo(() => G.lines >= 12 && Math.max.apply(null, colHeights(G.board)) >= 8, {}, 300);
      G.headless = false;
      G.banner = null;
      holdPiece();
      G.piece = { kind: 'T', rot: 0, x: 3, y: 6 };
    },
    check() { return G.lines >= 12 && Math.max.apply(null, colHeights(G.board)) >= 8 && !!G.piece && !!G.hold && G.queue.length >= 5; },
  },
  tetris: {
    run() {
      newGame(RUN_SEED, { headless: true });
      const o = { tetrisHungry: true };
      let hit = false;
      for (let i = 0; i < 300 && !G.over && !hit; i++) {
        const before = G.tetrises;
        G.headless = false;
        botPlay(o);
        if (G.tetrises > before) hit = true;
        if (G.clearing && !hit) resolveClear();
      }
      this._hit = hit;
      if (G.clearing) G.clearing.t = CLEAR_T * 0.45;
    },
    check() { return this._hit === true && !!G.clearing && G.clearing.rows.length === 4; },
  },
  tspin: {
    run() {
      // the same slot the mech-tspin theorem proves, dressed with a lived-in stack
      newGame(RUN_SEED, { headless: false });
      G.board.fill(null);
      setRows([[15, 'xx......x.'], [16, 'xxx.....x.'], [17, 'xxxx....xx'], [18, 'xxxx....x.'],
      [19, 'xxxx..x...'], [20, 'xxxx...xxx'], [21, 'xxxxx.xxxx']]);
      dress();
      G.lines = 24; G.level = 3; G.score = 18400; G.pieces = 61; G.b2b = true; G.combo = 1;
      G.piece = { kind: 'T', rot: 1, x: 3, y: 1 };
      while (fits('T', 1, 3, G.piece.y + 1)) G.piece.y++;
      rotate(1);
      lockPiece();
      this._spin = G.tspins;
      if (G.clearing) G.clearing.t = CLEAR_T * 0.4;
    },
    check() { return this._spin >= 1 && !!G.banner && G.banner.txt.indexOf('T-SPIN') >= 0; },
  },
  combo: {
    run() {
      newGame(RUN_SEED, { headless: false });
      G.board.fill(null);
      setRows([[16, 'xxx.....x.'], [17, 'xxxx....xx'], [18, 'xxxxx...xx'],
      [19, 'xxxxxxxxx.'], [20, 'xxxxxxxxx.'], [21, 'xxxxxxxxx.']]);
      dress();
      G.level = 4; G.lines = 36; G.score = 41200; G.pieces = 94;
      G.combo = 3; G.b2b = true;
      G.piece = { kind: 'I', rot: 1, x: 7, y: 6 };
      G.banner = { txt: G.combo + ' COMBO', t: 0, pts: 250, big: false, col: '#ffe14a' };
    },
    check() { return G.combo >= 3 && G.b2b === true && !!G.piece; },
  },
  danger: {
    run() {
      newGame(RUN_SEED, { headless: true });
      const r = runStack({ weights: Object.assign({}, WEIGHTS, { holes: 0 }) }, 400);
      // rewind is impossible; replay to the last moment before the top-out
      const target = Math.max(1, r.survived - 1);
      newGame(RUN_SEED, { headless: true });
      runStack({ weights: Object.assign({}, WEIGHTS, { holes: 0 }) }, target);
      G.headless = false;
      this._h = Math.max.apply(null, colHeights(G.board));
    },
    check() { return this._h >= 15 && !G.over; },
  },
  level: {
    run() {
      newGame(RUN_SEED, { headless: false });
      simRun(70);                        // 70 seconds of real 60Hz play
      G.banner = { txt: 'LEVEL ' + G.level, t: G.time, pts: 0, big: false, col: '#3ef0ff' };
    },
    check() { return G.level >= 5 && G.elapsed >= 60 && !G.over; },
  },
  gameover: {
    run() {
      // a real death: the hole-blind bot plays well for 200 pieces, then drowns in its own burials
      newGame(RUN_SEED, { headless: true });
      runStack({ weights: Object.assign({}, WEIGHTS, { holes: 0 }) }, 400);
      G.headless = false;
      G.screen = 'over';
    },
    check() { return G.over === true && G.lines >= 40; },
  },
};

// ------------------------------ boot ------------------------------
const QS = new URLSearchParams(location.search);
const URLSEED = +(QS.get('seed') || RUN_SEED) || RUN_SEED;
function boot() {
  cv = document.getElementById('cv');
  scene = document.createElement('canvas');       // the game always paints landscape here
  scene.width = 1280; scene.height = 720;
  cx = scene.getContext('2d');
  vx = cv.getContext('2d');
  const verify = QS.get('verify');
  const shot = QS.get('shot');
  if (verify) {
    try { runVerify(verify); }
    catch (e) { report(verify, 'ERROR', { error: String((e && e.message) || e) }); }
    return;
  }
  if (shot && SHOTS[shot]) {
    const def = SHOTS[shot];
    def.run();
    if (G) {
      G.shotMode = true; G.headless = false;
      G.shownScore = G.score;
      G.fx = G.fx.filter(f => !f.pop && G.clearing && G.clearing.rows.indexOf(f.y) >= 0);
      G.dust = []; G.lockFx = null;
      if (G.banner) G.banner.t = G.time - 0.12;
      G.drops = [];
    }
    const ok = def.check();
    document.title = (ok ? 'shot-OK:' : 'shot-FAILED:') + shot;
    fit();
    draw();
    return;
  }
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('resize', fit);
  cv.addEventListener('mousedown', () => { if (G.screen === 'title') newGame(URLSEED); else if (G.screen === 'over') newGame(G.seed + 1); });
  cv.addEventListener('touchstart', onTouchStart, { passive: false });
  cv.addEventListener('touchmove', onTouchMove, { passive: false });
  cv.addEventListener('touchend', onTouchEnd, { passive: false });
  cv.addEventListener('touchcancel', () => { TS = null; }, { passive: false });
  fit();
  newGame(URLSEED);
  G.screen = 'title';
  let last = 0;
  const loop = (ts) => {
    const dt = Math.min(0.05, (ts - last) / 1000); last = ts;
    if (G.screen === 'play') tick(dt);
    else G.time += dt;
    G.shownScore += (G.score - G.shownScore) * Math.min(1, dt * 8);
    if (Math.abs(G.score - G.shownScore) < 1) G.shownScore = G.score;
    draw();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
window.addEventListener('DOMContentLoaded', boot);
