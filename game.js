/**
 * 《英雄祭坛》试玩版 — Flowdom 式竖屏布局
 * 顶：对手信息 + 占比条 + 倒计时 + 敌方基地
 * 中：六边形战场（主面积）
 * 底：己方基地建筑 + 操作栏
 * 右：技能圆形按钮
 */
(function () {
  'use strict';
  const C = window.HA_CONFIG;
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  let cssScale = 1;
  let dpr = 1;

  function resize() {
    const wrap = document.getElementById('wrap');
    const ww = wrap.clientWidth;
    const wh = wrap.clientHeight;
    // 等比缩放填满可用区域（contain，不变形）；优先 cover 竖屏手机
    cssScale = Math.min(ww / C.VIEW_W, wh / C.VIEW_H);
    // 极窄/极宽时仍 contain，避免裁切关键 UI
    const cssW = Math.floor(C.VIEW_W * cssScale);
    const cssH = Math.floor(C.VIEW_H * cssScale);
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.floor(C.VIEW_W * dpr);
    canvas.height = Math.floor(C.VIEW_H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 100));

  // ---------- Layout regions (Flowdom-like) ----------
  function layoutRegions() {
    const W = C.VIEW_W, H = C.VIEW_H;
    const st = C.SAFE_TOP, sb = C.SAFE_BOTTOM;
    const topHudH = 44;
    const enemyBaseH = 78;
    const playerBaseH = 92;
    const actionH = 78;
    const topY = st;
    const enemyBaseY = topY + topHudH;
    const fieldTop = enemyBaseY + enemyBaseH;
    const actionY = H - sb - actionH;
    const playerBaseY = actionY - playerBaseH;
    const fieldBottom = playerBaseY;
    return {
      W, H, st, sb,
      topHud: { y: topY, h: topHudH },
      enemyBase: { y: enemyBaseY, h: enemyBaseH },
      field: { y: fieldTop, h: fieldBottom - fieldTop },
      playerBase: { y: playerBaseY, h: playerBaseH },
      action: { y: actionY, h: actionH },
      skillX: W - 58,
      skillStartY: fieldTop + 24
    };
  }

  function hexToPixel(col, row, originX, originY, size) {
    const x = size * Math.sqrt(3) * (col + 0.5 * (row & 1));
    const y = size * 1.5 * row;
    return { x: originX + x, y: originY + y };
  }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function counterMult(atk, def) {
    const up = C.COUNTERS[atk]; if (up && up[def] != null) return up[def];
    const down = C.COUNTERED[atk]; if (down && down[def] != null) return down[def];
    return 1;
  }

  let state = null;
  let ui = {
    screen: 'title', toast: '', toastT: 0,
    popup: null, // { kind:'upgrade'|'build', target, x, y, buttons:[] }
    _hits: []
  };

  function makePlayer(side) {
    return {
      side, gold: C.START_GOLD, faith: C.START_FAITH,
      bedLv: 1, cats: 0, gens: 0,
      slots: new Array(C.BUILD_SLOTS).fill(null),
      altars: {}, heroes: [],
      skillCd: { thunder: 0, drum: 0 },
      buff: { drumT: 0 }, tilesOwned: 0
    };
  }

  function initMap() {
    const tiles = [];
    for (let r = 0; r < C.HEX_ROWS; r++)
      for (let c = 0; c < C.HEX_COLS; c++)
        tiles.push({ c, r, owner: null, hp: C.TILE_HP_NEUTRAL, maxHp: C.TILE_HP_NEUTRAL });
    const map = { cols: C.HEX_COLS, rows: C.HEX_ROWS, tiles, byKey: Object.create(null) };
    for (const t of tiles) map.byKey[t.c + ',' + t.r] = t;
    return map;
  }

  function computeFieldLayout(regions) {
    const map = { cols: C.HEX_COLS, rows: C.HEX_ROWS };
    const availW = C.VIEW_W - 20;
    const availH = regions.field.h - 8;
    const sizeByW = availW / (Math.sqrt(3) * (map.cols + 0.5));
    const sizeByH = availH / (1.5 * (map.rows - 1) + 2);
    const size = Math.min(sizeByW, sizeByH, C.HEX_SIZE + 4);
    const gridW = size * Math.sqrt(3) * (map.cols - 0.5 + 0.5);
    const gridH = size * 1.5 * (map.rows - 1);
    const originX = (C.VIEW_W - gridW) / 2 + size * 0.15;
    const originY = regions.field.y + (regions.field.h - gridH) / 2;
    return { size, originX, originY };
  }

  function startMatch() {
    const regions = layoutRegions();
    const map = initMap();
    const layout = computeFieldLayout(regions);
    const player = makePlayer('player');
    const ai = makePlayer('ai');
    // 开局只有床，其余建筑位全空；祭坛需建造
    player.slots[0] = { type: 'bed', lv: 1 };
    ai.slots[0] = { type: 'bed', lv: 1 };
    state = {
      map, layout, regions, player, ai,
      timeLeft: C.MATCH_SECONDS, elapsed: 0,
      over: false, result: null, fx: [], aiThink: 0, divine: false,
      buildVersion: 'v2-build-pace'
    };
    recountTiles();
    ui.screen = 'play';
    ui.popup = null;
    ui.toast = '点空位建造祭坛/猫/电 · 攒钱约半分钟';
    ui.toastT = 3.5;
  }

  function recountTiles() {
    let p = 0, a = 0;
    for (const t of state.map.tiles) {
      if (t.owner === 'player') p++;
      else if (t.owner === 'ai') a++;
    }
    state.player.tilesOwned = p;
    state.ai.tilesOwned = a;
  }

  function prodMult(side) {
    let m = 1;
    if (state.divine) m *= C.DIVINE_PROD_MULT;
    const total = state.map.tiles.length;
    const mine = side === 'player' ? state.player.tilesOwned : state.ai.tilesOwned;
    const theirs = side === 'player' ? state.ai.tilesOwned : state.player.tilesOwned;
    if (mine < theirs) {
      const behindPct = (theirs - mine) / total;
      const steps = Math.floor(behindPct / C.BEHIND_STEP_PCT);
      m *= 1 + Math.min(C.BEHIND_BONUS_CAP, steps * C.BEHIND_BONUS_PER_STEP);
    }
    return m;
  }
  function goldIncome(pl) {
    return ((C.BED_GOLD_PER_SEC[pl.bedLv] || 2) + pl.cats * C.CAT_GOLD_PER_SEC) * prodMult(pl.side);
  }
  function faithIncome(pl) {
    return pl.gens * C.GEN_FAITH_PER_SEC * prodMult(pl.side);
  }

  function slotWorldPos(side, slotIndex) {
    const R = state.regions;
    const n = C.BUILD_SLOTS;
    const margin = 14;
    const w = C.VIEW_W - margin * 2;
    const x = margin + (slotIndex + 0.5) * (w / n);
    const y = side === 'player'
      ? R.playerBase.y + R.playerBase.h * 0.42
      : R.enemyBase.y + R.enemyBase.h * 0.55;
    return { x, y };
  }

  function spawnGate(side, altarId) {
    const pl = side === 'player' ? state.player : state.ai;
    const info = pl.altars[altarId];
    const sp = slotWorldPos(side, info.slot);
    const L = state.layout;
    if (side === 'player') {
      return { x: sp.x, y: L.originY + L.size * 1.5 * (state.map.rows - 1) + L.size * 0.15 };
    }
    return { x: sp.x, y: L.originY - L.size * 0.1 };
  }

  function heroStats(altarId, lv, buff) {
    const base = C.ALTARS[altarId].hero;
    const mulA = 1 + (lv - 1) * C.ALTAR_LV_ATK;
    const mulH = 1 + (lv - 1) * C.ALTAR_LV_HP;
    const mulT = 1 + (lv - 1) * C.ALTAR_LV_TILE;
    let atkInterval = base.atkInterval;
    let tileDmg = base.tileDmg * mulT;
    if (buff && buff.drumT > 0) {
      atkInterval /= C.SKILLS.drum.atkSpeedMult;
      tileDmg *= C.SKILLS.drum.tileDmgMult;
    }
    return {
      maxHp: Math.round(base.hp * mulH),
      atk: base.atk * mulA,
      atkInterval, speed: base.speed, tileDmg,
      range: base.range, rangeTile: base.rangeTile
    };
  }

  function trySpawn(pl, altarId) {
    const altar = pl.altars[altarId];
    if (!altar || altar.cd > 0) return false;
    const def = C.ALTARS[altarId];
    if (pl.gold < def.spawnGold || pl.faith < def.spawnFaith) return false;
    pl.gold -= def.spawnGold; pl.faith -= def.spawnFaith;
    altar.cd = C.SPAWN_CD;
    const st = heroStats(altarId, altar.lv, pl.buff);
    const gate = spawnGate(pl.side, altarId);
    pl.heroes.push({
      id: Math.random().toString(36).slice(2, 9),
      altarId, classId: def.classId, side: pl.side,
      x: gate.x + (Math.random() - 0.5) * 8, y: gate.y,
      hp: st.maxHp, maxHp: st.maxHp, atkCd: 0.2,
      emoji: def.emoji, color: def.color
    });
    return true;
  }

  function tryUpgradeBed(pl) {
    if (pl.bedLv >= C.BED_MAX_LV) return false;
    const cost = C.BED_UPGRADE_COST[pl.bedLv + 1];
    if (pl.gold < cost) return false;
    pl.gold -= cost; pl.bedLv++;
    const slot = pl.slots.find(s => s && s.type === 'bed');
    if (slot) slot.lv = pl.bedLv;
    return true;
  }
  function tryBuildAltar(pl, altarId, slotIndex) {
    if (pl.altars[altarId]) return false;
    if (slotIndex == null || pl.slots[slotIndex] != null) return false;
    const cost = C.ALTAR_BUILD_COST[altarId];
    if (cost == null || pl.gold < cost) return false;
    pl.gold -= cost;
    pl.slots[slotIndex] = { type: 'altar', altarId, lv: 1 };
    pl.altars[altarId] = { slot: slotIndex, lv: 1, cd: 0 };
    return true;
  }
  function tryBuildCat(pl, slotIndex) {
    if (pl.cats >= C.CAT_MAX || pl.gold < C.CAT_BUILD_COST) return false;
    let idx = slotIndex;
    if (idx == null) idx = pl.slots.findIndex(s => s == null);
    if (idx < 0 || pl.slots[idx] != null) return false;
    pl.gold -= C.CAT_BUILD_COST; pl.cats++;
    pl.slots[idx] = { type: 'cat', lv: 1 };
    return true;
  }
  function tryBuildGen(pl, slotIndex) {
    if (pl.gens >= C.GEN_MAX || pl.gold < C.GEN_BUILD_COST) return false;
    let idx = slotIndex;
    if (idx == null) idx = pl.slots.findIndex(s => s == null);
    if (idx < 0 || pl.slots[idx] != null) return false;
    pl.gold -= C.GEN_BUILD_COST; pl.gens++;
    pl.slots[idx] = { type: 'gen', lv: 1 };
    return true;
  }
  function tryUpgradeAltar(pl, altarId) {
    const altar = pl.altars[altarId];
    if (!altar) return false;
    const def = C.ALTARS[altarId];
    if (altar.lv >= def.maxLv) return false;
    const cost = def.upgradeCost[altar.lv + 1];
    if (pl.gold < cost) return false;
    pl.gold -= cost; altar.lv++;
    const slot = pl.slots[altar.slot];
    if (slot) slot.lv = altar.lv;
    return true;
  }

  function castSkill(pl, skillId) {
    const sk = C.SKILLS[skillId];
    if (!sk || pl.skillCd[skillId] > 0 || pl.faith < sk.faithCost) return false;
    pl.faith -= sk.faithCost;
    pl.skillCd[skillId] = sk.cd;
    if (skillId === 'thunder') {
      const enemies = (pl.side === 'player' ? state.ai : state.player).heroes;
      let cx = C.VIEW_W / 2, cy = state.regions.field.y + state.regions.field.h * 0.45;
      if (enemies.length) {
        cx = enemies.reduce((s, h) => s + h.x, 0) / enemies.length;
        cy = enemies.reduce((s, h) => s + h.y, 0) / enemies.length;
      }
      let hit = 0;
      for (const h of enemies) {
        if (dist(h, { x: cx, y: cy }) <= sk.radius) { h.hp -= sk.dmg; hit++; }
      }
      state.fx.push({ type: 'thunder', x: cx, y: cy, r: sk.radius, t: 0.45 });
      if (pl.side === 'player') { ui.toast = hit ? `神罚命中 ${hit}` : '神罚未命中'; ui.toastT = 1.4; }
    } else if (skillId === 'drum') {
      pl.buff.drumT = sk.duration;
      state.fx.push({ type: 'drum', side: pl.side, t: 0.6 });
      if (pl.side === 'player') { ui.toast = '蛮荒鼓点！'; ui.toastT = 1.2; }
    }
    return true;
  }

  function nearestEnemyHero(h, enemies) {
    let best = null, bd = 1e9;
    for (const e of enemies) {
      const d = dist(h, e);
      if (d < bd) { bd = d; best = e; }
    }
    return best ? { target: best, d: bd } : null;
  }
  function nearestHostileTile(h) {
    const L = state.layout;
    let best = null, bd = 1e9;
    for (const t of state.map.tiles) {
      if (t.owner === h.side) continue;
      const p = hexToPixel(t.c, t.r, L.originX, L.originY, L.size);
      const d = dist(h, p);
      if (d < bd) { bd = d; best = { tile: t, pos: p, d }; }
    }
    return best;
  }

  function updateHero(h, dt) {
    const pl = h.side === 'player' ? state.player : state.ai;
    const enemyPl = h.side === 'player' ? state.ai : state.player;
    const st = heroStats(h.altarId, pl.altars[h.altarId].lv, pl.buff);
    h.maxHp = st.maxHp;
    h.atkCd = Math.max(0, h.atkCd - dt);
    const near = nearestEnemyHero(h, enemyPl.heroes);
    if (near && near.d <= st.range + 6) {
      if (h.atkCd <= 0) {
        near.target.hp -= st.atk * counterMult(h.classId, near.target.classId);
        h.atkCd = st.atkInterval;
        state.fx.push({ type: 'hit', x: near.target.x, y: near.target.y, t: 0.15, color: h.color });
      }
      return;
    }
    let goal = null;
    if (near && near.d < 90) goal = { x: near.target.x, y: near.target.y };
    else {
      const nt = nearestHostileTile(h);
      if (nt) {
        if (nt.d <= st.rangeTile + state.layout.size * 0.55) {
          if (h.atkCd <= 0) {
            nt.tile.hp -= st.tileDmg;
            h.atkCd = st.atkInterval;
            state.fx.push({ type: 'tilehit', x: nt.pos.x, y: nt.pos.y, t: 0.12 });
            if (nt.tile.hp <= 0) {
              nt.tile.owner = h.side;
              nt.tile.maxHp = C.TILE_HP_OWNED;
              nt.tile.hp = C.TILE_HP_OWNED;
              recountTiles();
              checkWinByFill();
            }
          }
          return;
        }
        goal = nt.pos;
      }
    }
    if (goal) {
      const d = dist(h, goal);
      if (d > 1) {
        const sp = st.speed * dt;
        h.x += ((goal.x - h.x) / d) * Math.min(sp, d);
        h.y += ((goal.y - h.y) / d) * Math.min(sp, d);
      }
    }
  }

  function checkWinByFill() {
    const total = state.map.tiles.length;
    if (state.player.tilesOwned >= total) endMatch('player', '占满全图');
    else if (state.ai.tilesOwned >= total) endMatch('ai', '占满全图');
  }
  function endMatch(winner, reason) {
    if (state.over) return;
    state.over = true;
    state.result = { winner, reason };
    ui.screen = 'result';
    ui.popup = null;
  }
  function cleanupDead() {
    state.player.heroes = state.player.heroes.filter(h => h.hp > 0);
    state.ai.heroes = state.ai.heroes.filter(h => h.hp > 0);
  }

  function aiEmptySlots(pl) {
    const out = [];
    for (let i = 0; i < pl.slots.length; i++) if (!pl.slots[i]) out.push(i);
    return out;
  }
  function aiTick() {
    const pl = state.ai;
    const empties = aiEmptySlots(pl);
    // 优先攒钱建第一座祭坛（选偏左/中/右分散）
    const altarNeed = C.AI_SPAWN_PRIORITY.filter(id => !pl.altars[id]);
    // 已有祭坛时边攒边造兵；限制场上数量避免瞬间滚雪球
    if (pl.heroes.length < 4) {
      for (const id of C.AI_SPAWN_PRIORITY) {
        if (!pl.altars[id]) continue;
        const def = C.ALTARS[id];
        const reserve = pl.heroes.length >= 2 ? 25 : 10;
        if (pl.gold >= def.spawnGold + reserve && pl.faith >= def.spawnFaith && pl.altars[id].cd <= 0) {
          trySpawn(pl, id);
        }
      }
    }
    if (altarNeed.length && empties.length) {
      const id = altarNeed[0];
      const cost = C.ALTAR_BUILD_COST[id];
      // 保留一点金子造兵，再攒下一座祭坛
      const reserve = Object.keys(pl.altars).length ? 20 : 0;
      if (pl.gold >= cost + reserve) {
        const prefer = [2, 5, 7, 1, 3, 4, 6, 8];
        let slot = empties.find(i => prefer.includes(i)) ?? empties[0];
        if (tryBuildAltar(pl, id, slot)) return;
      }
      if (pl.bedLv < 2 && pl.gold >= C.BED_UPGRADE_COST[2] && Object.keys(pl.altars).length >= 1) {
        tryUpgradeBed(pl); return;
      }
      if (altarNeed.length && Object.keys(pl.altars).length === 0) return; // 首座前专心攒钱
    }
    if (pl.gens < 1 && empties.length && pl.gold >= C.GEN_BUILD_COST) {
      tryBuildGen(pl, empties[0]); return;
    }
    if (pl.cats < 2 && empties.length && pl.gold >= C.CAT_BUILD_COST + 20) {
      tryBuildCat(pl, empties[0]); return;
    }
    if (pl.bedLv < 3 && pl.gold >= C.BED_UPGRADE_COST[pl.bedLv + 1]) { tryUpgradeBed(pl); return; }
    for (const id of Object.keys(pl.altars)) {
      const al = pl.altars[id], def = C.ALTARS[id];
      if (al.lv < def.maxLv && pl.gold >= def.upgradeCost[al.lv + 1]) { tryUpgradeAltar(pl, id); return; }
    }
    if (pl.heroes.length < 5) {
      for (const id of C.AI_SPAWN_PRIORITY) {
        if (!pl.altars[id]) continue;
        const def = C.ALTARS[id];
        if (pl.gold >= def.spawnGold + 15 && pl.faith >= def.spawnFaith && pl.altars[id].cd <= 0) trySpawn(pl, id);
      }
    }
    if (pl.faith >= C.SKILLS.thunder.faithCost && pl.skillCd.thunder <= 0) {
      if (state.player.heroes.length >= 2 || state.divine) castSkill(pl, 'thunder');
    }
    if (pl.faith >= C.SKILLS.drum.faithCost && pl.skillCd.drum <= 0) {
      if (pl.heroes.length >= 3 || state.divine) castSkill(pl, 'drum');
    }
    if (pl.gens < C.GEN_MAX && empties.length && pl.gold >= C.GEN_BUILD_COST) tryBuildGen(pl, empties[0]);
    if (pl.cats < C.CAT_MAX && empties.length && pl.gold >= C.CAT_BUILD_COST) tryBuildCat(pl, empties[0]);
  }

  function update(dt) {
    if (!state || state.over || ui.screen !== 'play') {
      if (ui.toastT > 0) ui.toastT -= dt;
      return;
    }
    state.regions = layoutRegions();
    state.elapsed += dt;
    state.timeLeft = Math.max(0, C.MATCH_SECONDS - state.elapsed);
    state.divine = state.timeLeft <= C.DIVINE_LAST_SECONDS && state.timeLeft > 0;
    if (state.timeLeft <= 0) {
      if (state.player.tilesOwned > state.ai.tilesOwned) endMatch('player', '超时格多');
      else if (state.ai.tilesOwned > state.player.tilesOwned) endMatch('ai', '超时格多');
      else endMatch('draw', '超时平局');
      return;
    }
    state.player.gold += goldIncome(state.player) * dt;
    state.player.faith += faithIncome(state.player) * dt;
    state.ai.gold += goldIncome(state.ai) * dt;
    state.ai.faith += faithIncome(state.ai) * dt;
    for (const pl of [state.player, state.ai]) {
      for (const id of Object.keys(pl.altars)) pl.altars[id].cd = Math.max(0, pl.altars[id].cd - dt);
      for (const k of Object.keys(pl.skillCd)) pl.skillCd[k] = Math.max(0, pl.skillCd[k] - dt);
      if (pl.buff.drumT > 0) pl.buff.drumT = Math.max(0, pl.buff.drumT - dt);
    }
    for (const h of state.player.heroes) updateHero(h, dt);
    for (const h of state.ai.heroes) updateHero(h, dt);
    cleanupDead();
    state.aiThink -= dt;
    if (state.aiThink <= 0) { state.aiThink = C.AI_THINK_INTERVAL; aiTick(); }
    state.fx = state.fx.filter(f => { f.t -= dt; return f.t > 0; });
    if (ui.toastT > 0) ui.toastT -= dt;
  }

  // ---------- Draw ----------
  function drawHex(x, y, size, fill, stroke) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 180 * (60 * i - 30);
      const px = x + size * Math.cos(a), py = y + size * Math.sin(a);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }

  function draw() {
    ui._hits = [];
    ctx.clearRect(0, 0, C.VIEW_W, C.VIEW_H);
    // desert-ish bg like Flowdom
    const g = ctx.createLinearGradient(0, 0, 0, C.VIEW_H);
    g.addColorStop(0, '#3d2e22');
    g.addColorStop(0.35, '#2a3340');
    g.addColorStop(0.65, '#243044');
    g.addColorStop(1, '#1e2a24');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, C.VIEW_W, C.VIEW_H);

    if (ui.screen === 'title') { drawTitle(); return; }
    if (!state) return;

    drawSideDecor();
    drawTopHud();
    drawBaseStrip('ai');
    drawMap();
    drawHeroes();
    drawFx();
    drawBaseStrip('player');
    drawSkillSide();
    drawActionBar();
    if (ui.popup) drawPopup();
    if (ui.toastT > 0 && ui.toast) drawToast();
    if (ui.screen === 'result') drawResult();
  }

  function drawSideDecor() {
    // soft rocks / margin
    ctx.fillStyle = 'rgba(90,70,45,0.35)';
    ctx.beginPath(); ctx.ellipse(8, C.VIEW_H * 0.35, 28, 60, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(C.VIEW_W - 6, C.VIEW_H * 0.55, 26, 70, 0, 0, Math.PI * 2); ctx.fill();
  }

  function drawTitle() {
    ctx.fillStyle = '#f5e6c8';
    ctx.font = 'bold 34px system-ui,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('英雄祭坛', C.VIEW_W / 2, 260);
    ctx.font = '14px system-ui';
    ctx.fillStyle = '#b8c0d0';
    ctx.fillText('竖屏六边形占格 · Flowdom 式布局', C.VIEW_W / 2, 295);
    ctx.fillText('1v1 vs 电脑 · 占满或超时格多胜', C.VIEW_W / 2, 318);
    const bx = C.VIEW_W / 2 - 95, by = 380, bw = 190, bh = 52;
    ctx.fillStyle = '#c9a227';
    roundRect(bx, by, bw, bh, 14); ctx.fill();
    ctx.fillStyle = '#1a1040';
    ctx.font = 'bold 20px system-ui';
    ctx.fillText('开始对局', C.VIEW_W / 2, by + 33);
    ui._hits.push({ id: 'start', x: bx, y: by, w: bw, h: bh });
    ctx.fillStyle = '#7a8499';
    ctx.font = '12px system-ui';
    ctx.fillText('狂战士 · 圣骑士 · 法师', C.VIEW_W / 2, 470);
    ctx.fillText('点建筑弹出升级 · 右侧技能', C.VIEW_W / 2, 492);
  }

  function drawTopHud() {
    const R = state.regions;
    const y = R.topHud.y;
    const total = state.map.tiles.length || 1;
    const pPct = state.player.tilesOwned / total;
    const aPct = state.ai.tilesOwned / total;
    // bar background
    const bx = 56, by = y + 8, bw = C.VIEW_W - 112, bh = 16;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    roundRect(bx, by, bw, bh, 8); ctx.fill();
    // player (green/blue left) vs ai (red right) — Flowdom style tug bar
    const pW = bw * pPct;
    const aW = bw * aPct;
    ctx.fillStyle = '#2e86de';
    roundRect(bx, by, Math.max(0, pW), bh, 8); ctx.fill();
    ctx.fillStyle = '#e74c3c';
    ctx.fillRect(bx + bw - aW, by, Math.max(0, aW), bh);
    // percents
    ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.fillText(Math.round(pPct * 100) + '%', bx + 6, by + 12);
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(aPct * 100) + '%', bx + bw - 6, by + 12);
    // avatars
    ctx.beginPath(); ctx.arc(28, y + 22, 16, 0, Math.PI * 2);
    ctx.fillStyle = '#27ae60'; ctx.fill();
    ctx.font = '14px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🧑', 28, y + 23);
    ctx.beginPath(); ctx.arc(C.VIEW_W - 28, y + 22, 16, 0, Math.PI * 2);
    ctx.fillStyle = '#c0392b'; ctx.fill();
    ctx.fillText('🤖', C.VIEW_W - 28, y + 23);
    // timer under bar
    const mm = Math.floor(state.timeLeft / 60);
    const ss = Math.floor(state.timeLeft % 60);
    ctx.textBaseline = 'alphabetic';
    ctx.font = 'bold 15px system-ui';
    ctx.textAlign = 'center';
    ctx.fillStyle = state.divine ? '#ffd700' : '#f5f5f5';
    ctx.fillText(state.divine ? '神降 ' + `${mm}:${ss.toString().padStart(2, '0')}` : `${mm}:${ss.toString().padStart(2, '0')}`, C.VIEW_W / 2, y + 40);
  }

  function drawBaseStrip(side) {
    const R = state.regions;
    const zone = side === 'player' ? R.playerBase : R.enemyBase;
    const pl = side === 'player' ? state.player : state.ai;
    // wall / safe zone wash
    ctx.fillStyle = side === 'player' ? 'rgba(46,204,113,0.10)' : 'rgba(231,76,60,0.12)';
    ctx.fillRect(0, zone.y, C.VIEW_W, zone.h);
    // gate wall line
    const wallY = side === 'player' ? zone.y + 4 : zone.y + zone.h - 6;
    ctx.fillStyle = '#8b7355';
    ctx.fillRect(24, wallY, C.VIEW_W - 48, 5);
    // doors
    ctx.fillStyle = '#5c4030';
    for (let i = 0; i < 3; i++) {
      const dx = 70 + i * ((C.VIEW_W - 140) / 2);
      ctx.fillRect(dx - 10, wallY - 2, 20, 9);
    }
    // buildings
    for (let i = 0; i < C.BUILD_SLOTS; i++) {
      const p = slotWorldPos(side, i);
      const b = pl.slots[i];
      ctx.beginPath();
      ctx.arc(p.x, p.y, 17, 0, Math.PI * 2);
      ctx.fillStyle = b ? '#3a4658' : 'rgba(30,40,55,0.55)';
      ctx.fill();
      ctx.strokeStyle = side === 'player' ? '#2ecc71' : '#e74c3c';
      ctx.lineWidth = 1.5; ctx.stroke();
      if (b) {
        let em = '🛏️';
        if (b.type === 'cat') em = '🐱';
        else if (b.type === 'gen') em = '⚡';
        else if (b.type === 'altar') em = C.ALTARS[b.altarId].emoji;
        ctx.font = '15px serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        ctx.fillText(em, p.x, p.y + 1);
        ctx.font = '9px system-ui';
        ctx.fillStyle = '#ffd700';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText('L' + (b.lv || 1), p.x, p.y + 26);
        if (side === 'player') {
          ui._hits.push({ id: 'slot', slot: i, x: p.x - 20, y: p.y - 20, w: 40, h: 44 });
        }
      } else if (side === 'player') {
        ui._hits.push({ id: 'empty', slot: i, x: p.x - 18, y: p.y - 18, w: 36, h: 36 });
      }
    }
    // castle center hint
    ctx.font = '11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillStyle = side === 'player' ? 'rgba(46,204,113,0.7)' : 'rgba(231,76,60,0.7)';
    ctx.fillText(side === 'player' ? '我方基地' : '敌方基地', C.VIEW_W / 2, side === 'player' ? zone.y + zone.h - 8 : zone.y + 12);
  }

  function drawMap() {
    const L = state.layout;
    // field plate
    const R = state.regions;
    ctx.fillStyle = 'rgba(210,180,130,0.08)';
    ctx.fillRect(8, R.field.y, C.VIEW_W - 16, R.field.h);
    for (const t of state.map.tiles) {
      const p = hexToPixel(t.c, t.r, L.originX, L.originY, L.size);
      let fill = '#cbb896'; // neutral sand like Flowdom
      if (t.owner === 'player') fill = '#3d8fd1';
      else if (t.owner === 'ai') fill = '#d35454';
      drawHex(p.x, p.y, L.size * 0.94, fill, '#8a7a5c');
      if (t.hp < t.maxHp) {
        const ratio = clamp(t.hp / t.maxHp, 0, 1);
        ctx.beginPath();
        ctx.arc(p.x, p.y, L.size * 0.32, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
        ctx.strokeStyle = '#fff8';
        ctx.lineWidth = 2.5; ctx.stroke();
      }
    }
  }

  function drawHeroes() {
    const all = state.player.heroes.concat(state.ai.heroes);
    for (const h of all) {
      ctx.beginPath();
      ctx.arc(h.x, h.y, 11, 0, Math.PI * 2);
      ctx.fillStyle = h.side === 'player' ? '#2980b9' : '#c0392b';
      ctx.fill();
      ctx.strokeStyle = h.color; ctx.lineWidth = 2; ctx.stroke();
      ctx.font = '12px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(h.emoji, h.x, h.y + 1);
      const bw = 18, bh = 3;
      ctx.fillStyle = '#0008';
      ctx.fillRect(h.x - bw / 2, h.y - 16, bw, bh);
      ctx.fillStyle = h.side === 'player' ? '#5dade2' : '#e74c3c';
      ctx.fillRect(h.x - bw / 2, h.y - 16, bw * clamp(h.hp / h.maxHp, 0, 1), bh);
    }
  }

  function drawFx() {
    for (const f of state.fx) {
      if (f.type === 'thunder') {
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r * (1.2 - f.t), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,220,80,${clamp(f.t * 2, 0, 1)})`;
        ctx.lineWidth = 3; ctx.stroke();
        ctx.fillStyle = `rgba(255,240,150,${f.t * 0.5})`; ctx.fill();
      } else if (f.type === 'hit' || f.type === 'tilehit') {
        ctx.globalAlpha = clamp(f.t * 5, 0, 1);
        ctx.fillStyle = f.color || '#fff';
        ctx.beginPath(); ctx.arc(f.x, f.y, 4, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      } else if (f.type === 'drum') {
        ctx.fillStyle = `rgba(241,196,15,${f.t})`;
        const y = f.side === 'player' ? state.regions.playerBase.y : state.regions.enemyBase.y + state.regions.enemyBase.h - 6;
        ctx.fillRect(0, y, C.VIEW_W, 6);
      }
    }
  }

  function drawSkillSide() {
    const R = state.regions;
    const skills = ['thunder', 'drum'];
    let y = R.skillStartY;
    for (const id of skills) {
      const sk = C.SKILLS[id];
      const cd = state.player.skillCd[id];
      const can = cd <= 0 && state.player.faith >= sk.faithCost;
      const x = R.skillX, r = 26;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = can ? '#4a3a78' : '#2a303c';
      ctx.fill();
      ctx.strokeStyle = can ? '#c4b5fd' : '#555';
      ctx.lineWidth = 2; ctx.stroke();
      if (cd > 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (cd / sk.cd));
        ctx.closePath(); ctx.fill();
      }
      ctx.font = '18px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.fillText(sk.emoji, x, y - 2);
      ctx.font = '9px system-ui'; ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#ddd';
      ctx.fillText(cd > 0 ? Math.ceil(cd) + 's' : sk.faithCost + '✨', x, y + r + 12);
      ui._hits.push({ id: 'skill', skillId: id, x: x - r, y: y - r, w: r * 2, h: r * 2 + 14 });
      y += 78;
    }
  }

  function drawActionBar() {
    const R = state.regions;
    const y = R.action.y;
    ctx.fillStyle = 'rgba(10,14,22,0.72)';
    ctx.fillRect(0, y, C.VIEW_W, R.action.h + C.SAFE_BOTTOM);

    ctx.textAlign = 'left';
    ctx.font = '13px system-ui';
    ctx.fillStyle = '#ffd700';
    ctx.fillText(`💰 ${Math.floor(state.player.gold)}  +${goldIncome(state.player).toFixed(1)}/s`, 14, y + 22);
    ctx.fillStyle = '#c4b5fd';
    ctx.fillText(`✨ ${Math.floor(state.player.faith)}  +${faithIncome(state.player).toFixed(1)}/s`, 14, y + 42);

    const altarCount = Object.keys(state.player.altars).length;
    ctx.fillStyle = '#aeb6c4';
    ctx.font = '11px system-ui';
    ctx.fillText(`祭坛 ${altarCount}/3 · 猫 ${state.player.cats}/${C.CAT_MAX} · 电 ${state.player.gens}/${C.GEN_MAX}`, 14, y + 62);
    ctx.fillStyle = '#6b7280';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'right';
    ctx.fillText('点空位建造 · 点建筑操作', C.VIEW_W - 14, y + 62);
  }

  function openSlotPopup(slotIndex) {
    const b = state.player.slots[slotIndex];
    if (!b) openBuildMenu(slotIndex);
    else openUpgradePopup(slotIndex);
  }

  function openBuildMenu(slotIndex) {
    const p = slotWorldPos('player', slotIndex);
    const pl = state.player;
    const buttons = [];
    for (const id of ['berserker', 'paladin', 'mage']) {
      const def = C.ALTARS[id];
      const cost = C.ALTAR_BUILD_COST[id];
      const owned = !!pl.altars[id];
      const canPay = pl.gold >= cost;
      buttons.push({
        action: owned || !canPay ? 'noop' : 'buildAltar',
        altarId: id, slot: slotIndex,
        label: owned ? `${def.emoji}${def.name} 已建造` : `${def.emoji}${def.name}  ${cost}💰`,
        color: owned ? '#555' : (canPay ? def.color : '#666'),
        disabled: owned || !canPay
      });
    }
    const catMax = pl.cats >= C.CAT_MAX;
    const catPay = pl.gold >= C.CAT_BUILD_COST;
    buttons.push({
      action: catMax || !catPay ? 'noop' : 'buildCat',
      slot: slotIndex,
      label: catMax ? `🐱招财猫 已满(${C.CAT_MAX})` : `🐱招财猫  ${C.CAT_BUILD_COST}💰`,
      color: catMax ? '#555' : (catPay ? '#e67e22' : '#666'),
      disabled: catMax || !catPay
    });
    const genMax = pl.gens >= C.GEN_MAX;
    const genPay = pl.gold >= C.GEN_BUILD_COST;
    buttons.push({
      action: genMax || !genPay ? 'noop' : 'buildGen',
      slot: slotIndex,
      label: genMax ? `⚡发电机 已满(${C.GEN_MAX})` : `⚡发电机  ${C.GEN_BUILD_COST}💰`,
      color: genMax ? '#555' : (genPay ? '#3498db' : '#666'),
      disabled: genMax || !genPay
    });
    const bw = 210;
    const bh = 36 + buttons.length * 36 + 8;
    ui.popup = {
      kind: 'build',
      slot: slotIndex,
      title: '建造',
      x: clamp(p.x - bw / 2, 8, C.VIEW_W - bw - 8),
      y: Math.max(state.regions.field.y + 4, p.y - bh - 8),
      bw, buttons
    };
  }

  function openUpgradePopup(slotIndex) {
    const b = state.player.slots[slotIndex];
    if (!b) { openBuildMenu(slotIndex); return; }
    const p = slotWorldPos('player', slotIndex);
    const buttons = [];
    if (b.type === 'altar') {
      const def = C.ALTARS[b.altarId];
      const al = state.player.altars[b.altarId];
      buttons.push({
        action: 'spawn', altarId: b.altarId,
        label: `造兵 ${def.spawnGold}💰${def.spawnFaith}✨`,
        color: def.color
      });
      if (al.lv < def.maxLv) {
        buttons.push({
          action: 'upAltar', altarId: b.altarId,
          label: `升级 L${al.lv}→${al.lv + 1}  ${def.upgradeCost[al.lv + 1]}💰`,
          color: '#c9a227'
        });
      } else {
        buttons.push({ action: 'noop', label: '已满级', color: '#666', disabled: true });
      }
    } else if (b.type === 'bed') {
      if (state.player.bedLv < C.BED_MAX_LV) {
        buttons.push({
          action: 'upBed',
          label: `升床 L${state.player.bedLv}→${state.player.bedLv + 1}  ${C.BED_UPGRADE_COST[state.player.bedLv + 1]}💰`,
          color: '#c9a227'
        });
      } else buttons.push({ action: 'noop', label: '床已满级', color: '#666', disabled: true });
    } else {
      buttons.push({ action: 'noop', label: b.type === 'cat' ? '招财猫（已建成）' : '发电机（已建成）', color: '#888', disabled: true });
    }
    const bw = 200;
    ui.popup = {
      kind: 'ops',
      slot: slotIndex,
      title: '建筑操作',
      x: clamp(p.x - bw / 2, 8, C.VIEW_W - bw - 8),
      y: Math.max(state.regions.field.y + 8, p.y - 120),
      bw,
      buttons
    };
  }

  function drawPopup() {
    const pop = ui.popup;
    if (!pop) return;
    const bw = pop.bw || 180;
    const bh = 36 + pop.buttons.length * 36 + 10;
    ctx.fillStyle = 'rgba(0,0,0,0.78)';
    roundRect(pop.x, pop.y, bw, bh, 12); ctx.fill();
    ctx.strokeStyle = '#c9a227'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#eee';
    ctx.font = '12px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(pop.title || '建筑操作', pop.x + bw / 2, pop.y + 20);
    let by = pop.y + 30;
    pop._btnHits = [];
    for (const b of pop.buttons) {
      const disabled = !!b.disabled || b.action === 'noop';
      ctx.fillStyle = disabled ? '#2a2f38' : (b.color + '55');
      roundRect(pop.x + 10, by, bw - 20, 30, 8); ctx.fill();
      ctx.strokeStyle = disabled ? '#555' : b.color; ctx.stroke();
      ctx.fillStyle = disabled ? '#888' : '#fff';
      ctx.font = '12px system-ui';
      ctx.fillText(b.label, pop.x + bw / 2, by + 20);
      pop._btnHits.push({ ...b, x: pop.x + 10, y: by, w: bw - 20, h: 30 });
      by += 36;
    }
    ctx.fillStyle = '#888';
    ctx.font = '10px system-ui';
    ctx.fillText('点空白关闭', pop.x + bw / 2, pop.y + bh - 6);
  }

  function drawToast() {
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    roundRect(36, C.VIEW_H / 2 - 18, C.VIEW_W - 72, 36, 10); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '13px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(ui.toast, C.VIEW_W / 2, C.VIEW_H / 2 + 5);
  }

  function drawResult() {
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(0, 0, C.VIEW_W, C.VIEW_H);
    const r = state.result;
    let title = '平局', color = '#ccc';
    if (r.winner === 'player') { title = '胜利！'; color = '#2ecc71'; }
    else if (r.winner === 'ai') { title = '失败'; color = '#e74c3c'; }
    ctx.fillStyle = color;
    ctx.font = 'bold 36px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(title, C.VIEW_W / 2, 320);
    ctx.fillStyle = '#ddd';
    ctx.font = '14px system-ui';
    ctx.fillText(r.reason, C.VIEW_W / 2, 360);
    ctx.fillText(`我方 ${state.player.tilesOwned}  ·  敌方 ${state.ai.tilesOwned}`, C.VIEW_W / 2, 388);
    const bx = C.VIEW_W / 2 - 90, by = 430, bw = 180, bh = 48;
    ctx.fillStyle = '#c9a227';
    roundRect(bx, by, bw, bh, 12); ctx.fill();
    ctx.fillStyle = '#1a1040';
    ctx.font = 'bold 18px system-ui';
    ctx.fillText('再来一局', C.VIEW_W / 2, by + 31);
    ui._hits.push({ id: 'again', x: bx, y: by, w: bw, h: bh });
  }

  // ---------- Input ----------
  function canvasPos(e) {
    const rect = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return {
      x: (src.clientX - rect.left) * (C.VIEW_W / rect.width),
      y: (src.clientY - rect.top) * (C.VIEW_H / rect.height)
    };
  }
  function hit(btn, p) {
    return p.x >= btn.x && p.x <= btn.x + btn.w && p.y >= btn.y && p.y <= btn.y + btn.h;
  }

  function onPointer(e) {
    e.preventDefault();
    const p = canvasPos(e);
    if (ui.screen === 'title') {
      for (const h of ui._hits) if (h.id === 'start' && hit(h, p)) startMatch();
      return;
    }
    if (ui.screen === 'result') {
      for (const h of ui._hits) if (h.id === 'again' && hit(h, p)) startMatch();
      return;
    }
    if (ui.screen !== 'play' || !state || state.over) return;

    // popup buttons first
    if (ui.popup && ui.popup._btnHits) {
      for (const b of ui.popup._btnHits) {
        if (hit(b, p)) {
          if (b.disabled || b.action === 'noop') {
            ui.toast = b.label.includes('已') ? b.label : '无法建造';
            ui.toastT = 1;
            return;
          }
          let ok = false;
          if (b.action === 'spawn') ok = trySpawn(state.player, b.altarId);
          else if (b.action === 'upAltar') ok = tryUpgradeAltar(state.player, b.altarId);
          else if (b.action === 'upBed') ok = tryUpgradeBed(state.player);
          else if (b.action === 'buildAltar') ok = tryBuildAltar(state.player, b.altarId, b.slot);
          else if (b.action === 'buildCat') ok = tryBuildCat(state.player, b.slot);
          else if (b.action === 'buildGen') ok = tryBuildGen(state.player, b.slot);
          ui.toast = ok ? '完成' : '资源不足或冷却中';
          ui.toastT = 1;
          if (ok && (b.action === 'upAltar' || b.action === 'upBed')) {
            openUpgradePopup(ui.popup.slot);
          } else if (ok) {
            ui.popup = null;
          }
          return;
        }
      }
      const pop = ui.popup;
      const bw = pop.bw || 180;
      const bh = 36 + pop.buttons.length * 36 + 10;
      if (!(p.x >= pop.x && p.x <= pop.x + bw && p.y >= pop.y && p.y <= pop.y + bh)) {
        ui.popup = null;
      } else return;
    }

    for (const h of ui._hits) {
      if (!hit(h, p)) continue;
      if (h.id === 'skill') {
        if (!castSkill(state.player, h.skillId)) {
          ui.toast = '技能冷却中或信仰不足'; ui.toastT = 1.2;
        }
        return;
      }
      if (h.id === 'slot' || h.id === 'empty') {
        openSlotPopup(h.slot);
        return;
      }
    }
    ui.popup = null;
  }

  canvas.addEventListener('mousedown', onPointer);
  canvas.addEventListener('touchstart', onPointer, { passive: false });

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  window.HA = {
    startMatch,
    getState: () => state,
    getUI: () => ui,
    castSkill: (id) => state && castSkill(state.player, id),
    spawn: (id) => state && trySpawn(state.player, id),
    upgradeBed: () => state && tryUpgradeBed(state.player),
    buildAltar: (id, slot) => state && tryBuildAltar(state.player, id, slot),
    buildCat: (slot) => state && tryBuildCat(state.player, slot),
    buildGen: (slot) => state && tryBuildGen(state.player, slot),
    openSlot: (i) => state && openSlotPopup(i),
    openBuildMenu: (i) => state && openBuildMenu(i),
    forceTime: (secLeft) => {
      if (!state) return;
      state.elapsed = C.MATCH_SECONDS - secLeft;
      state.timeLeft = secLeft;
    },
    /** 加速模拟：推进 dt 秒（可多次），用于自测打满一局 */
    tick: (seconds) => {
      if (!state || state.over) return;
      const step = 0.05;
      let left = seconds;
      while (left > 0 && state && !state.over && ui.screen === 'play') {
        const dt = Math.min(step, left);
        update(dt);
        left -= dt;
      }
    },
    endNow: (w) => endMatch(w || 'player', '测试结束'),
    version: 'v2-build-pace'
  };

  resize();
  requestAnimationFrame(frame);
})();
