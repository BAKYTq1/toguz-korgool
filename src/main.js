import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';
import { createGame, playMove, ownerOf } from './rules.js';

/* ============================================================
   Layout constants — logical board space (matches a real
   folding travel set: black tray row1 + cream tray row2)
   ============================================================ */
const BASE_W = 1120, BASE_H = 460;
const KAZAN_W = 108;
const PANEL_W = BASE_W - KAZAN_W * 2;
const PANEL_H = 196;
const HINGE_GAP = 16;
const PIT_W = 62, PIT_H = 158;
const PIT_MARGIN_X = 46;
const PIT_SPACING = (PANEL_W - PIT_MARGIN_X * 2 - PIT_W) / 8;
const BEAD_R = 12.5;

const BEAD_COLORS = [0x2f8f89, 0x3aa39c, 0x256f6a];

function pitCenter(idx){
  const player = ownerOf(idx);
  const iInRow = player === 0 ? idx : idx - 9;
  const colFromLeft = player === 0 ? iInRow : (8 - iInRow); // mirror row2 so sowing loops visually
  const x = KAZAN_W + PIT_MARGIN_X + PIT_W / 2 + colFromLeft * PIT_SPACING;
  const y = player === 0 ? PANEL_H / 2 : PANEL_H + HINGE_GAP + PANEL_H / 2;
  return { x, y };
}
function kazanCenter(player){
  return player === 0 ? { x: BASE_W - KAZAN_W / 2, y: BASE_H / 2 } : { x: KAZAN_W / 2, y: BASE_H / 2 };
}
function beadLayout(count){
  const cap = Math.min(count, 14);
  const cols = cap <= 7 ? 1 : 2;
  const perCol = Math.ceil(cap / cols);
  const positions = [];
  for(let i = 0; i < cap; i++){
    const col = Math.floor(i / perCol);
    const row = i % perCol;
    const colOffset = cols === 1 ? 0 : (col === 0 ? -15 : 15);
    const spanH = PIT_H - 30;
    const t = perCol <= 1 ? 0.5 : row / (perCol - 1);
    const y = -spanH / 2 + t * spanH;
    positions.push({ dx: colOffset + (row % 2 === 0 ? -3 : 3), dy: y });
  }
  return positions;
}

/* ============================================================
   Game state (pure logic lives in rules.js)
   ============================================================ */
const game = createGame();
let animating = false;
let visualPits = game.pits.slice();
let visualKazan = game.kazan.slice();
function syncVisual(){ visualPits = game.pits.slice(); visualKazan = game.kazan.slice(); }

/* ============================================================
   Multiplayer — thin WebSocket relay client.
   The server knows nothing about the rules; it only forwards
   {type:'move', idx} between the two sockets in a room, so both
   sides run the identical deterministic logic locally.
   ============================================================ */
const mp = { enabled: false, ws: null, myPlayer: -1, room: null, connId: 0 };

function mpSetStatus(text){
  const el = document.getElementById('mp-status');
  if(el) el.textContent = text;
}

function mpConnect(serverUrl, roomId){
  if(!serverUrl){ mpSetStatus('Укажите адрес сервера.'); return; }
  if(!roomId){ mpSetStatus('Укажите код комнаты.'); return; }

  // fully neutralize any previous connection so it can never double-apply moves
  if(mp.ws){
    mp.ws.onopen = null; mp.ws.onmessage = null; mp.ws.onclose = null; mp.ws.onerror = null;
    try{ mp.ws.close(); } catch{}
  }
  mp.connId += 1;
  const myConnId = mp.connId;

  let ws;
  try{
    ws = new WebSocket(serverUrl);
  } catch(e){
    mpSetStatus('Не удалось подключиться: ' + e.message);
    return;
  }
  mp.ws = ws;
  mp.room = roomId;
  mp.enabled = false;
  mpSetStatus('Подключение к серверу...');
  setMpButtonsDisabled(true);

  ws.addEventListener('open', () => {
    if(myConnId !== mp.connId) return; // superseded by a newer connection
    ws.send(JSON.stringify({ type: 'join', room: roomId }));
  });
  ws.addEventListener('message', (ev) => {
    if(myConnId !== mp.connId) return; // ignore anything from a stale/replaced socket
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if(msg.type === 'joined'){
      mp.myPlayer = msg.youAre;
      mpSetStatus(`Вы — Ойунчу ${mp.myPlayer + 1}. Комната «${roomId}». Ждём соперника...`);
    } else if(msg.type === 'start'){
      mp.enabled = true;
      mpSetStatus(`Соперник подключился! Вы — Ойунчу ${mp.myPlayer + 1}.`);
      document.getElementById('mp-toggle').classList.add('linked');
      setMpButtonsDisabled(false);
      setTimeout(() => document.getElementById('mp-modal').classList.remove('show'), 900);
    } else if(msg.type === 'move'){
      window.__toguzRemoteMove && window.__toguzRemoteMove(msg.idx);
    } else if(msg.type === 'restart'){
      window.__toguzRestart && window.__toguzRestart(true);
    } else if(msg.type === 'peer-left'){
      mpSetStatus('Соперник отключился от игры.');
    } else if(msg.type === 'error'){
      mpSetStatus('Ошибка: ' + msg.message);
      setMpButtonsDisabled(false);
    }
  });
  ws.addEventListener('close', () => {
    if(myConnId !== mp.connId) return;
    if(mp.enabled) mpSetStatus('Соединение с сервером потеряно.');
    mp.enabled = false;
    setMpButtonsDisabled(false);
  });
  mp.ws.addEventListener('error', () => {
    mpSetStatus('Не удалось подключиться. Проверьте адрес сервера.');
  });
}

function mpRandomRoom(){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for(let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/* ============================================================
   Drawing helpers
   ============================================================ */
function drawBead(g, x, y, r, colorIdx){
  const c = BEAD_COLORS[colorIdx % BEAD_COLORS.length];
  g.ellipse(x, y + r * 0.75, r * 0.85, r * 0.35).fill({ color: 0x000000, alpha: 0.28 });
  g.circle(x, y, r).fill(c);
  g.circle(x, y, r).fill({ color: 0x123c39, alpha: 0.18 });
  g.circle(x - r * 0.32, y - r * 0.35, r * 0.28).fill({ color: 0xffffff, alpha: 0.55 });
}
function makeBead(colorIdx){
  const g = new Graphics();
  drawBead(g, 0, 0, BEAD_R, colorIdx);
  return g;
}

function capsulePath(g, cx, cy, w, h){
  g.roundRect(cx - w / 2, cy - h / 2, w, h, w / 2);
}

function drawPitWell(gfx, idx, lifted, isTuzduk = false){
  const p = pitCenter(idx);
  const dark = ownerOf(idx) === 0;
  gfx.clear();
  const scale = lifted ? 1.07 : 1;
  const cx = p.x, cy = p.y;
  const w = PIT_W * scale, h = PIT_H * scale;
  capsulePath(gfx, cx, cy, w, h);
  
  if(isTuzduk){
    // Tuzduk - darker, like a hole
    gfx.fill(0x0a0806);
    capsulePath(gfx, cx, cy, w * 0.86, h * 0.9);
    gfx.fill(0x000000);
    capsulePath(gfx, cx, cy, w, h);
    gfx.stroke({ width: 2, color: 0xd4af37, alpha: 0.6 });  // Gold border for tuzduk
  } else {
    gfx.fill(dark ? 0x050403 : 0x9c9273);
    // inner shading capsule for a soft recessed look
    capsulePath(gfx, cx, cy, w * 0.86, h * 0.9);
    gfx.fill(dark ? 0x020201 : 0x8f8567);
    capsulePath(gfx, cx, cy, w, h);
    gfx.stroke({ width: 1.5, color: dark ? 0xffffff : 0x000000, alpha: dark ? 0.18 : 0.25 });
    // always-visible accent rim so an empty pit never blends into the panel
    capsulePath(gfx, cx, cy, w, h);
    gfx.stroke({ width: 1, color: 0x57c2b8, alpha: 0.14 });
  }
  
  if(lifted && !isTuzduk){
    capsulePath(gfx, cx, cy, w, h);
    gfx.stroke({ width: 3, color: 0x57c2b8, alpha: 0.85 });
  }
}

function drawHalo(gfx, idx, pulse){
  const p = pitCenter(idx);
  gfx.clear();
  capsulePath(gfx, p.x, p.y, PIT_W + 10, PIT_H + 10);
  gfx.stroke({ width: 4, color: 0xd4af37, alpha: 0.55 + pulse * 0.3 });
}

/* ============================================================
   PixiJS application setup
   ============================================================ */
const app = new Application();

async function init(){
  await app.init({ resizeTo: window, backgroundAlpha: 0, antialias: true, resolution: Math.min(window.devicePixelRatio || 1, 2) });
  document.getElementById('pixi-container').appendChild(app.canvas);

  const board = new Container();
  app.stage.addChild(board);

  /* ---- static background: panels, hinge, kazan trays, grain ---- */
  const staticLayer = new Graphics();
  drawStatic(staticLayer);
  board.addChild(staticLayer);

  const kazanBeadLayers = [new Container(), new Container()];
  kazanBeadLayers.forEach(c => board.addChild(c));

  /* ---- pits ---- */
  const pitRecords = [];
  for(let idx = 0; idx < 18; idx++){
    const well = new Graphics();
    drawPitWell(well, idx, false);
    board.addChild(well);

    const halo = new Graphics();
    halo.visible = false;
    board.addChild(halo);

    const beadsLayer = new Container();
    board.addChild(beadsLayer);

    const labelChip = new Graphics();
    const labelText = new Text({ text: '', style: new TextStyle({ fontFamily: 'Bitter, Georgia, serif', fontSize: 15, fontWeight: '800', fill: 0xfff8e8 }) });
    labelText.anchor.set(0.5);
    const labelGroup = new Container();
    labelGroup.addChild(labelChip, labelText);
    labelGroup.visible = false;
    board.addChild(labelGroup);

    const tuzLabel = new Text({ text: 'ТУЗ', style: new TextStyle({ fontFamily: 'Bitter, Georgia, serif', fontSize: 14, fontWeight: 'bold', fill: 0xd4af37 }) });
    tuzLabel.anchor.set(0.5);
    tuzLabel.visible = false;
    board.addChild(tuzLabel);

    const p = pitCenter(idx);
    labelGroup.position.set(p.x, p.y - PIT_H / 2 - 16);
    tuzLabel.position.set(p.x, p.y - PIT_H / 2 - 28);

    pitRecords.push({ idx, well, halo, beadsLayer, labelChip, labelText, labelGroup, tuzLabel, lastCount: -1 });
  }

  const topLayer = new Container();
  board.addChild(topLayer);

  /* ============================================================
     Rendering sync — rebuild only what changed
     ============================================================ */
  function rebuildPitBeads(rec, count){
    rec.beadsLayer.removeChildren().forEach(c => c.destroy());
    const p = pitCenter(rec.idx);
    const layout = beadLayout(count);
    layout.forEach((o, i) => {
      const b = makeBead(rec.idx + i);
      b.position.set(p.x + o.dx, p.y + o.dy);
      rec.beadsLayer.addChild(b);
    });
  }
  function rebuildKazanBeads(player, count){
    const layer = kazanBeadLayers[player];
    layer.removeChildren().forEach(c => c.destroy());
    const k = kazanCenter(player);
    const show = Math.min(count, 60);  // Show up to 60 beads
    const cols = 3;  // 3 columns instead of 6
    const startRow = Math.max(0, Math.ceil(show / cols) - 5);
    let idx = 0;
    for(let row = startRow; row < Math.ceil(show / cols); row++){
      for(let col = 0; col < cols && idx < show; col++){
        const dx = (col - (cols - 1) / 2) * 20;
        const dy = (row - startRow) * 20;
        const b = makeBead(idx);
        b.position.set(k.x + dx, k.y + dy);
        layer.addChild(b);
        idx++;
      }
    }
  }
  function updateLabel(rec, count){
    if(rec.lastCount === count) return;
    rec.lastCount = count;
    const empty = count <= 0;
    rec.labelGroup.visible = true;
    rec.labelText.text = empty ? '0' : String(count);
    rec.labelText.alpha = empty ? 0.5 : 1;
    const tw = rec.labelText.width;
    rec.labelChip.clear();
    rec.labelChip.roundRect(-tw / 2 - 7, -11, tw + 14, 22, 11).fill({ color: 0x0a0806, alpha: empty ? 0.45 : 0.8 });
    rec.labelChip.roundRect(-tw / 2 - 7, -11, tw + 14, 22, 11).stroke({ width: 1, color: 0x57c2b8, alpha: empty ? 0.25 : 0.55 });
    // Show TUZ label: on active tuzduk OR on opponent's pit with exactly 3 stones (potential tuzduk)
    const isActiveTuzduk = game.tuzduk[0] === rec.idx || game.tuzduk[1] === rec.idx;
    const isOpponentPit = ownerOf(rec.idx) !== game.current;
    const isNotActiveTuzduk = game.tuzduk[0] !== rec.idx && game.tuzduk[1] !== rec.idx;
    const canActivateTuzduk = game.tuzduk[game.current] === -1 && game.tuzduk[1 - game.current] === -1;
    const isPotentialTuzduk = (count === 3 && isOpponentPit && isNotActiveTuzduk && canActivateTuzduk);
    rec.tuzLabel.visible = (isActiveTuzduk || isPotentialTuzduk);
  }

  function refreshAll(){
    for(const rec of pitRecords){
      const isTuz = game.tuzduk[0] === rec.idx || game.tuzduk[1] === rec.idx;
      drawPitWell(rec.well, rec.idx, false, isTuz);
      rebuildPitBeads(rec, game.pits[rec.idx]);
      updateLabel(rec, game.pits[rec.idx]);
      rec.halo.visible = isTuz;
    }
    rebuildKazanBeads(0, game.kazan[0]);
    rebuildKazanBeads(1, game.kazan[1]);
    updateUI();
  }

  /* ---- dragging (hold beads with the cursor) ---- */
  let dragging = false, dragIdx = -1, dragCount = 0;
  let dragCluster = null;
  const dragLogical = { x: 0, y: 0 };
  const remoteMoveQueue = [];

  /* ---- flying beads (one-by-one sowing animation) ---- */
  const flying = [];
  function flyBead(from, to, dur, onArrive){
    const gfx = makeBead(1);
    topLayer.addChild(gfx);
    flying.push({ gfx, from, to, t0: performance.now(), dur, onArrive, done: false });
  }

  function animateHandSowing(beforePits, startIdx, result){
    const { steps, ended, endReason } = result;
    visualPits = beforePits.slice();
    const remaining = game.pits[startIdx]; // How many stones left after the move
    visualPits[startIdx] = remaining;
    pitRecords[startIdx] && rebuildPitBeads(pitRecords[startIdx], remaining);
    pitRecords[startIdx] && updateLabel(pitRecords[startIdx], remaining);
    let fromPos = pitCenter(startIdx);
    let i = 0;
    function scheduleNext(){
      if(i >= steps.length){
        // Handle captured stones (if any)
        if(result.captureInfo){
          visualKazan[result.player] += result.captureInfo.amount;
          const finalCount = game.pits[result.captureInfo.pit];  // Get actual final count
          visualPits[result.captureInfo.pit] = finalCount;
          rebuildPitBeads(pitRecords[result.captureInfo.pit], finalCount);
          updateLabel(pitRecords[result.captureInfo.pit], finalCount);
          rebuildKazanBeads(result.player, visualKazan[result.player]);
          // If tuzduk was activated, redraw the pit as a tuzduk (dark with gold border)
          if(result.captureInfo.type === 'tuzduk'){
            drawPitWell(pitRecords[result.captureInfo.pit].well, result.captureInfo.pit, false, true);
          }
        }
        syncVisual();
        animating = false;
        if(ended){
          setTimeout(() => showEnd(endReason), 300);
        } else if(remoteMoveQueue.length){
          const queuedIdx = remoteMoveQueue.shift();
          attemptMove(queuedIdx, { fromRemote: true });
        }
        return;
      }
      const step = steps[i];
      const toPos = step.toKazan !== -1 ? kazanCenter(step.toKazan) : pitCenter(step.pit);
      flyBead(fromPos, toPos, 165, () => {
        if(step.toKazan !== -1){
          visualKazan[step.toKazan]++;
          rebuildKazanBeads(step.toKazan, visualKazan[step.toKazan]);
        } else {
          visualPits[step.pit] = (visualPits[step.pit] || 0) + 1;
          rebuildPitBeads(pitRecords[step.pit], visualPits[step.pit]);
          updateLabel(pitRecords[step.pit], visualPits[step.pit]);
        }
        fromPos = toPos;
        i++;
        scheduleNext();
      });
    }
    scheduleNext();
  }

  function attemptMove(idx, opts = {}){
    if(animating || game.gameOver) return;
    if(ownerOf(idx) !== game.current || game.pits[idx] <= 0) return;
    if(mp.enabled && !opts.fromRemote && mp.myPlayer !== game.current) return; // not your turn online
    animating = true;
    const beforePits = game.pits.slice();
    const result = playMove(game, idx);
    animateHandSowing(beforePits, idx, result);
    updateUI();
    if(mp.enabled && !opts.fromRemote && mp.ws && mp.ws.readyState === 1){
      mp.ws.send(JSON.stringify({ type: 'move', idx }));
    }
  }
  window.__toguzRemoteMove = (idx) => {
    if(animating){ remoteMoveQueue.push(idx); return; }
    attemptMove(idx, { fromRemote: true });
  };

  const invalidFlash = {};
  function flashInvalid(idx){
    invalidFlash[idx] = performance.now();
  }

  /* ---- input: manual pointer math (robust, matches board's own transform) ---- */
  let scale = 1, offX = 0, offY = 0;
  function toLogical(clientX, clientY){
    return { x: (clientX - offX) / scale, y: (clientY - offY) / scale };
  }
  function pitAt(lp){
    for(let idx = 0; idx < 18; idx++){
      const p = pitCenter(idx);
      if(Math.abs(lp.x - p.x) < PIT_W / 2 + 14 && Math.abs(lp.y - p.y) < PIT_H / 2 + 14) return idx;
    }
    return -1;
  }

  function layout(){
    const w = window.innerWidth, h = window.innerHeight;
    const availTop = 132, availBottom = 74;
    const availW = w * 0.95, availH = (h - availTop - availBottom);
    scale = Math.min(availW / BASE_W, availH / BASE_H) * 0.96;
    offX = (w - BASE_W * scale) / 2;
    offY = availTop + (availH - BASE_H * scale) / 2;
    board.position.set(offX, offY);
    board.scale.set(scale);
  }
  window.addEventListener('resize', layout);
  layout();

  app.canvas.addEventListener('pointerdown', ev => {
    if(animating || game.gameOver) return;
    const lp = toLogical(ev.clientX, ev.clientY);
    const idx = pitAt(lp);
    if(idx === -1 || ownerOf(idx) !== game.current || game.pits[idx] <= 0){
      if(idx !== -1) flashInvalid(idx);
      return;
    }
    if(mp.enabled && mp.myPlayer !== game.current) return;
    dragging = true; dragIdx = idx; dragCount = game.pits[idx];
    dragLogical.x = lp.x; dragLogical.y = lp.y;
    app.canvas.style.cursor = 'grabbing';
    drawPitWell(pitRecords[idx].well, idx, true);
    dragCluster = new Container();
    topLayer.addChild(dragCluster);
  });
  window.addEventListener('pointermove', ev => {
    const lp = toLogical(ev.clientX, ev.clientY);
    if(dragging){
      dragLogical.x = lp.x; dragLogical.y = lp.y;
    } else if(!animating && !game.gameOver){
      const idx = pitAt(lp);
      const myTurn = !mp.enabled || mp.myPlayer === game.current;
      app.canvas.style.cursor = (idx !== -1 && ownerOf(idx) === game.current && game.pits[idx] > 0 && myTurn) ? 'grab' : 'default';
    }
  });
  window.addEventListener('pointerup', () => {
    if(!dragging) return;
    dragging = false;
    app.canvas.style.cursor = 'default';
    drawPitWell(pitRecords[dragIdx].well, dragIdx, false);
    if(dragCluster){ dragCluster.destroy({ children: true }); dragCluster = null; }
    attemptMove(dragIdx);
  });
  window.addEventListener('pointercancel', () => {
    dragging = false;
    app.canvas.style.cursor = 'default';
    if(dragIdx !== -1) drawPitWell(pitRecords[dragIdx].well, dragIdx, false);
    if(dragCluster){ dragCluster.destroy({ children: true }); dragCluster = null; }
  });

  /* ============================================================
     Ticker — per-frame animation
     ============================================================ */
  app.ticker.add(() => {
    const now = performance.now();

    // flying beads
    for(let i = flying.length - 1; i >= 0; i--){
      const f = flying[i];
      const t = Math.min(1, (now - f.t0) / f.dur);
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const mx = f.from.x + (f.to.x - f.from.x) * ease;
      const my = f.from.y + (f.to.y - f.from.y) * ease;
      const arc = Math.sin(t * Math.PI) * 38;
      const perpX = -(f.to.y - f.from.y), perpY = (f.to.x - f.from.x);
      const len = Math.hypot(perpX, perpY) || 1;
      const landSquash = t > 0.92 ? 1 - (t - 0.92) * 1.5 : 1;
      f.gfx.position.set(mx + (perpX / len) * arc * 0.22, my - arc);
      f.gfx.scale.set(1.08, 1.08 * landSquash);
      if(t >= 1 && !f.done){
        f.done = true;
        f.gfx.destroy();
        flying.splice(i, 1);
        f.onArrive();
      }
    }

    // held cluster follows the pointer
    if(dragging && dragCluster){
      dragCluster.removeChildren().forEach(c => c.destroy());
      const n = Math.min(dragCount, 6);
      for(let i = 0; i < n; i++){
        const a = (i / n) * Math.PI * 2 + now / 500;
        const b = makeBead(i);
        b.position.set(dragLogical.x + Math.cos(a) * 13, dragLogical.y + Math.sin(a) * 13 - 6);
        dragCluster.addChild(b);
      }
    }

    // tuzduk pulse
    if(game.tuzduk[0] !== -1 || game.tuzduk[1] !== -1){
      const pulse = 0.5 + Math.sin(now / 280) * 0.25;
      for(const rec of pitRecords){
        if(rec.halo.visible) drawHalo(rec.halo, rec.idx, pulse);
      }
    }

    // invalid-move flash
    for(const rec of pitRecords){
      const t0 = invalidFlash[rec.idx];
      if(t0 && now - t0 < 260 && !(dragging && rec.idx === dragIdx)){
        const a = 1 - (now - t0) / 260;
        drawPitWell(rec.well, rec.idx, false);
        const p = pitCenter(rec.idx);
        rec.well.roundRect(p.x - PIT_W / 2, p.y - PIT_H / 2, PIT_W, PIT_H, PIT_W / 2)
          .fill({ color: 0xb5292f, alpha: a * 0.55 });
      } else if(t0 && now - t0 >= 260){
        delete invalidFlash[rec.idx];
      }
    }
  });

  syncVisual();
  refreshAll();
  window.__toguzRestart = (fromRemote) => {
    Object.assign(game, createGame());
    animating = false;
    remoteMoveQueue.length = 0;
    syncVisual();
    document.getElementById('overlay-msg').classList.remove('show');
    refreshAll();
    if(mp.enabled && !fromRemote && mp.ws && mp.ws.readyState === 1){
      mp.ws.send(JSON.stringify({ type: 'restart' }));
    }
  };
}

function drawStatic(g){
  // black panel (row1)
  g.roundRect(KAZAN_W, 0, PANEL_W, PANEL_H, 20).fill(0x171310);
  g.roundRect(KAZAN_W, 0, PANEL_W, PANEL_H, 20).stroke({ width: 1.5, color: 0xffffff, alpha: 0.06 });

  // cream panel (row2)
  const y2 = PANEL_H + HINGE_GAP;
  g.roundRect(KAZAN_W, y2, PANEL_W, PANEL_H, 20).fill(0xe1dabf);
  g.roundRect(KAZAN_W, y2, PANEL_W, PANEL_H, 20).stroke({ width: 1.5, color: 0x000000, alpha: 0.08 });

  // hinge bar + pins
  g.roundRect(KAZAN_W + 20, PANEL_H, PANEL_W - 40, HINGE_GAP, 6).fill(0x8c8c8c);
  [KAZAN_W + 70, BASE_W - KAZAN_W - 70].forEach(px => {
    g.circle(px, PANEL_H + HINGE_GAP / 2, 8).fill(0xb0b0b0);
    g.circle(px, PANEL_H + HINGE_GAP / 2, 4).fill(0xe8e8e8);
  });

  // kazan trays
  [0, 1].forEach(player => {
    const k = kazanCenter(player);
    const dark = player === 0;
    g.roundRect(k.x - KAZAN_W / 2 + 8, 10, KAZAN_W - 16, BASE_H - 20, 22).fill(dark ? 0x1c1812 : 0xe4dec8);
    capsulePath(g, k.x, k.y, KAZAN_W - 40, BASE_H - 70);
    g.fill(dark ? 0x050403 : 0xc7bd9c);
  });

  // subtle grain
  for(let i = 0; i < 160; i++){
    const x = KAZAN_W + Math.random() * PANEL_W;
    const y = Math.random() * (PANEL_H * 2 + HINGE_GAP);
    const onBlack = y < PANEL_H;
    g.circle(x, y, 0.6 + Math.random() * 1.4).fill({ color: onBlack ? 0xffffff : 0x000000, alpha: onBlack ? 0.04 : 0.06 });
  }
}

/* ============================================================
   DOM UI (score panels, turn banner, overlay) — unchanged
   ============================================================ */
const scoreP1El = document.getElementById('score-p1');
const scoreP2El = document.getElementById('score-p2');
const panelP1 = document.getElementById('panel-p1');
const panelP2 = document.getElementById('panel-p2');
const turnName = document.getElementById('turn-name');
const tuzdukP1El = document.getElementById('tuzduk-p1');
const tuzdukP2El = document.getElementById('tuzduk-p2');

function updateUI(){
  scoreP1El.innerHTML = game.kazan[0] + '<span>/162</span>';
  scoreP2El.innerHTML = game.kazan[1] + '<span>/162</span>';
  panelP1.classList.toggle('active', game.current === 0 && !game.gameOver);
  panelP2.classList.toggle('active', game.current === 1 && !game.gameOver);
  turnName.textContent = game.gameOver ? '—' : (game.current === 0 ? 'Ойунчу 1' : 'Ойунчу 2');
  tuzdukP1El.textContent = game.tuzduk[0] !== -1 ? `Туздук: чуңкур №${game.tuzduk[0] - 9 + 1}` : '';
  tuzdukP2El.textContent = game.tuzduk[1] !== -1 ? `Туздук: чуңкур №${game.tuzduk[1] + 1}` : '';
}

function showEnd(reason){
  const overlay = document.getElementById('overlay-msg');
  const title = document.getElementById('overlay-title');
  const text = document.getElementById('overlay-text');
  if(reason === 'p1'){ title.textContent = 'Ойунчу 1 жеңди!'; text.textContent = `Ойунчу 1: ${game.kazan[0]} коргоол, Ойунчу 2: ${game.kazan[1]} коргоол.`; }
  else if(reason === 'p2'){ title.textContent = 'Ойунчу 2 жеңди!'; text.textContent = `Ойунчу 2: ${game.kazan[1]} коргоол, Ойунчу 1: ${game.kazan[0]} коргоол.`; }
  else { title.textContent = 'Тең байге!'; text.textContent = `Эки тарапта тен: ${game.kazan[0]} — ${game.kazan[1]}.`; }
  overlay.classList.add('show');
}

document.getElementById('restart').addEventListener('click', () => window.__toguzRestart && window.__toguzRestart());
document.getElementById('restart-btn-2').addEventListener('click', () => window.__toguzRestart && window.__toguzRestart());

const mpToggle = document.getElementById('mp-toggle');
const mpModal = document.getElementById('mp-modal');
const mpServerInput = document.getElementById('mp-server');
const mpRoomInput = document.getElementById('mp-room');

mpToggle.addEventListener('click', () => mpModal.classList.add('show'));
document.getElementById('mp-close').addEventListener('click', () => mpModal.classList.remove('show'));
document.getElementById('mp-create').addEventListener('click', () => {
  const room = mpRandomRoom();
  mpRoomInput.value = room;
  mpConnect(mpServerInput.value.trim(), room);
});
document.getElementById('mp-join').addEventListener('click', () => {
  mpConnect(mpServerInput.value.trim(), mpRoomInput.value.trim());
});

init();