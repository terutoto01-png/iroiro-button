// いろいろボタン: ゆうえんち モード（あそびば）
// まんなか: ボタンの しま と おおどおり / ひだり: おおきな のりものゾーン / みぎ: やたい・あそびゾーン
// ゆうぐは のって いっしょに うごける（じめんを おすと おりる）。かぞくべや でも どうき する。
window.Park = (() => {
  const S = 1.75;
  const COLS = 5, PAD = 1.0, TOP = 1.9;
  const ZPAD = 1.0, ZW_L = 13.4, ZW_R = 9.2, ZGAP = 1.8;
  const MX_L = ZPAD + ZW_L + ZGAP;        // 16.2（ひだり のりものゾーン + れんらくみち）
  const MX_R = ZPAD + ZW_R + ZGAP;        // 12.0（みぎ やたいゾーン + れんらくみち）
  const BLV = 2.6, AV = 1.5, GATE = 4.1, END = 3.4;
  let U = 100;
  let W = 0, H = 0, BX = 0, XL = 0, XR = 0;
  let zones = null, toyHub = null;
  let built = false, active = false, rafId = 0, last = 0, curIsl = -1;
  let view = null, world = null, jump = null, skyBtn = null, exitBtn = null, warpBar = null;
  let deps = null;

  const islands = [];
  const attrs = new Map();
  const roads = [];
  const plazas = [];
  const roadEls = [], plazaEls = [];
  const props = [];
  const spots = [];
  const keys = [];
  const trains = []; // 6へんせい の ミニトレイン（おおどおり・ぐるっと1しゅう・よこシャトル）
  const SKIES = [['day', '☀️'], ['eve', '🌇'], ['night', '🌙']];
  let skyIdx = 0;
  const AVS = new Set(['🐶', '🐱', '🐰', '🐻', '🐼', '🐸', '🦊', '🐧', '🐷', '🐥', '🦁', '🐨', '🧒']);

  let me = null;
  const peers = new Map();
  const wasAt = new Map();
  let lastIn = '';
  let entering = false;
  let hold = null;
  const cam = { x: 0, y: 0, snap: true };
  const near = new Map();

  function layout() {
    const GROUPS = deps.groups;
    const w = COLS * S + PAD * 2;
    W = MX_L + w * 2 + BLV + MX_R; BX = MX_L + w + BLV / 2;
    let y = GATE;
    for (let gi = 0; gi < GROUPS.length; gi += 2) {
      const row = GROUPS.slice(gi, gi + 2);
      const hs = row.map(g => TOP + Math.ceil(g.items.length / COLS) * S + 0.5);
      roads.push([ZPAD + 0.2, y, W - (ZPAD + 0.2) * 2, AV]);
      plazas.push([BX, y + AV / 2, 1.9]);
      row.forEach((g, j) => {
        const isl = { gi: gi + j, g, x: MX_L + j * (w + BLV), y: y + AV, w, h: hs[j] };
        islands.push(isl);
        g.items.forEach((f, k) => {
          const c = k % COLS, r = Math.floor(k / COLS);
          attrs.set(f, { file: f, x: isl.x + PAD + S / 2 + c * S, y: isl.y + TOP + S / 2 + r * S, el: null, booth: null, isl });
        });
      });
      y += AV + Math.max(...hs);
    }
    roads.push([ZPAD + 0.2, y, W - (ZPAD + 0.2) * 2, AV]);
    plazas.push([BX, y + AV / 2, 1.9]);
    H = y + AV + END;
    roads.push([BX - BLV / 2, 0.2, BLV, H - 0.4]);
    // さゆうの ゆうえんち ゾーン ぞいの たてみち（ぐるっと トレイン が はしる）
    XL = ZPAD + ZW_L + ZGAP / 2;
    XR = W - ZPAD - ZW_R - ZGAP / 2;
    roads.push([XL - 0.7, GATE, 1.4, y - GATE + AV]);
    roads.push([XR - 0.7, GATE, 1.4, y - GATE + AV]);
    const zy = GATE + AV, zh = y - zy;
    zones = {
      left:  { x: ZPAD, y: zy, w: ZW_L, h: zh, cx: ZPAD + ZW_L / 2 },
      right: { x: W - ZPAD - ZW_R, y: zy, w: ZW_R, h: zh, cx: W - ZPAD - ZW_R / 2 },
    };
  }
  const inIsland = (x, y, m = 0) => islands.some(il => x > il.x - m && x < il.x + il.w + m && y > il.y - m && y < il.y + il.h + m);
  const inZone = (x, y, m = 0) => zones && [zones.left, zones.right].some(z => x > z.x - m && x < z.x + z.w + m && y > z.y - m && y < z.y + z.h + m);
  const onRoad = (x, y, m = 0) => roads.some(([rx, ry, rw, rh]) => x > rx - m && x < rx + rw + m && y > ry - m && y < ry + rh + m);
  const spawnAt = () => [BX, GATE - 0.55];
  const areaFront = (il) => [il.x + il.w / 2, il.y + 1.0];

  const THEME = [
    ['🌙', '⭐', '🌠', '🪐', '🌟'],
    ['🎈', '🎀', '🎊', '🍭', '🍬'],
    ['🚦', '🚧', '🌲', '🪨', '🌲'],
    ['🐾', '🦴', '🌳', '🍄', '🦋'],
    ['🌷', '🌻', '🌼', '🍀', '🫧'],
    ['🎵', '🎹', '🎸', '🔔', '🎵'],
    ['🎲', '🎯', '🧩', '🎮', '🎲'],
  ];
  const SWAY = new Set(['🎈', '🫧', '🦋', '🎵', '⭐', '🌟']);
  const BUNT = ['#ff5a5a', '#ffd23f', '#4fc3f7', '#8fce73', '#b388ff', '#ff9f1c'];
  function addProp(el, x, y, z) {
    el.style.zIndex = String(z ?? 100 + Math.round(y * 10));
    world.appendChild(el); props.push({ el, x, y });
    return el;
  }
  function emojiProp(e, x, y, size, cls = '') {
    const d = document.createElement('i');
    d.className = 'deco' + (SWAY.has(e) ? ' sway' : '') + (cls ? ' ' + cls : ''); d.textContent = e;
    d.style.setProperty('--s', size); d.style.animationDelay = (-((x * 7 + y * 3) % 3)).toFixed(2) + 's';
    return addProp(d, x, y);
  }
  function arch(x, y, e, bg, bd, main) {
    const a = document.createElement('div');
    a.className = 'arch' + (main ? ' main' : '');
    a.style.setProperty('--bg', bg); a.style.setProperty('--bd', bd);
    a.innerHTML = `<i class="post l"></i><i class="post r"></i><b><span>${e}</span></b>`;
    return addProp(a, x, y);
  }
  function lamp(x, y) {
    const l = document.createElement('i'); l.className = 'lamp';
    return addProp(l, x, y);
  }
  function bunting(x0, x1, y) {
    const b = document.createElement('div'); b.className = 'bunting';
    const n = Math.max(3, Math.round((x1 - x0) / 0.36));
    for (let i = 0; i < n; i++) { const f = document.createElement('i'); f.style.background = BUNT[i % BUNT.length]; b.appendChild(f); }
    b.dataset.w = x1 - x0;
    return addProp(b, x0, y, 100 + Math.round((y + 1.3) * 10));
  }
  function decorate() {
    let s = 12345;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const used = [];
    const free = (x, y, r = 0.7) => x > 0.3 && x < W - 0.3 && y > 0.4 && y < H - 0.2 && !inIsland(x, y, 0.3) && !inZone(x, y, 0.35) && !onRoad(x, y, 0.25)
      && !used.some(([ux, uy, ur]) => Math.hypot(ux - x, uy - y) < Math.max(r, ur));
    const put = (e, x, y, size, r = 0.7) => { if (!free(x, y, r)) return null; used.push([x, y, r]); return emojiProp(e, x, y, size); };

    arch(BX, GATE - 1.25, '🎡', '#fff', '#ff5a8a', true);
    for (const dx of [-2.2, 2.2]) {
      for (let k = 0; k < 3; k++) emojiProp('🎈', BX + dx + (k - 1) * 0.35, GATE - 1.2 - (k % 2) * 0.3, 0.6);
      spots.push({ type: 'balloon', x: BX + dx, y: GATE - 1.0, r: 0.9 });
    }
    const castle = emojiProp('🏰', BX, H - 0.35, 2.4);
    castle.style.zIndex = '60';
    spots.push({ type: 'castle', x: BX, y: H - 1.0, r: 1.7, el: castle });
    plazas.forEach(([x, y], i) => {
      if (i % 2 === 1) spots.push({ type: 'fountain', x, y: y + 0.3, r: 1.15, el: emojiProp('⛲', x, y + 0.45, 1.1) });
      else {
        const type = i % 4 === 0 ? 'tramp' : 'kuru';
        const el = document.createElement('div');
        el.className = type; el.innerHTML = '<i></i>';
        spots.push({ type, x, y: y + 0.2, r: 0.75, el: addProp(el, x, y + 0.2, 60) });
      }
    });
    const lx0 = BX - BLV / 2 + 0.2, lx1 = BX + BLV / 2 - 0.2;
    let k = 0;
    for (let y = GATE + 0.8; y < H - END; y += 2.4) {
      if (plazas.some(([, py, r]) => Math.abs(py - y) < r + 0.6)) continue;
      lamp(lx0, y); lamp(lx1, y);
      if (k++ % 2 === 0) bunting(lx0, lx1, y - 1.2);
    }
    for (const [rx, ry, rw, rh] of roads) if (rh < 2) for (const x of [rx + 0.35, rx + rw - 0.35]) lamp(x, ry + 0.35);

    for (const il of islands) {
      il.arch = arch(il.x + il.w / 2, il.y + 0.28, il.g.e, il.g.bg, il.g.bd, false);
      const th = THEME[il.gi] || THEME[0];
      const n = il.g.items.length, cols = COLS, rows = Math.ceil(n / cols);
      for (let c = n % cols ? n % cols : cols; c < cols; c++) {
        const x = il.x + PAD + S / 2 + c * S, y = il.y + TOP + S / 2 + (rows - 1) * S + 0.3;
        emojiProp(th[(c + il.gi) % th.length], x, y, 0.75);
      }
    }
    // あきスペース（みぎしたの しばふ など）に かんらんしゃ スポット
    const wSpots = [[BX + BLV / 2 + 5.2, islands[islands.length - 1].y + 3.6], [BX - 6.0, GATE - 1.4]];
    for (const [wx, wy] of wSpots) {
      const el = emojiProp('🎡', wx, wy, 1.6);
      spots.push({ type: 'wheel', x: wx, y: wy + 0.2, r: 1.3, el });
    }
    for (let i = 0; i < 200; i++) {
      const e = ['🌳', '🌷', '🌸', '🌳', '🌲'][Math.floor(rnd() * 5)];
      put(e, rnd() * W, rnd() * H, e === '🌳' || e === '🌲' ? 0.75 : 0.5);
    }
  }

  function makeChr(av, hu, isMe) {
    const el = document.createElement('div');
    el.className = 'chr' + (isMe ? ' me' : '');
    el.innerHTML = '<i class="shadow"></i><b><span></span></b>';
    el.querySelector('span').textContent = av;
    el.style.setProperty('--c', `hsl(${hu ?? 200}, 95%, 60%)`);
    world.appendChild(el);
    return { el, x: 0, y: 0, tx: 0, ty: 0, enter: null, face: 1, av, hu, itemKind: '', ride: null, dismountUntil: 0 };
  }
  function setAv(c, av, hu) {
    if (c.av !== av) { c.av = av; c.el.querySelector('span').textContent = av; }
    if (c.hu !== hu) { c.hu = hu; c.el.style.setProperty('--c', `hsl(${hu ?? 200}, 95%, 60%)`); }
  }
  function equip(c, kind, em, useHue = false) {
    const old = c.el.querySelector('.held');
    if (old) old.remove();
    c.itemKind = kind;
    if (!kind) return;
    const it = document.createElement('i');
    it.className = 'held ' + (kind === 'balloon' ? 'bal' : 'item-' + kind);
    it.textContent = em;
    if (useHue) it.style.filter = `hue-rotate(${Math.round(c.hu ?? 0)}deg)`;
    c.el.querySelector('b').appendChild(it);
  }

  // ---- のりもの に のる / おりる（かぞくべや でも どうき） ----
  // id: 1=メリーゴーラウンド, 2=シーソー, 3=ジェットコースター, 4=おおきなかんらんしゃ, 5=ミニトレイン
  function board(c, id, slot, send = false) {
    if (c.ride && c.ride.id === id && c.ride.slot === slot) return;
    c.ride = { id, slot };
    c.enter = null;
    c.el.classList.remove('walk');
    c.el.classList.add('riding');
    hopChr(c, c === me);
    if (send && c === me && deps && deps.Multi.group) deps.Multi.send({ a: 'g', i: 5, m: [id, slot] }, 0);
  }
  function dismount(c, send = false, now = performance.now()) {
    if (!c || !c.ride) return;
    c.ride = null;
    c.dismountUntil = now + 1800;
    c.el.classList.remove('riding', 'ride');
    if (send && c === me && deps && deps.Multi.group) deps.Multi.send({ a: 'g', i: 5, m: [0, 0] }, 0);
  }
  function canBoard(c, now) {
    return !c.ride && now > (c.dismountUntil || 0) && Math.hypot(c.tx - c.x, c.ty - c.y) < 0.14;
  }
  function setRidePos(c, x, y, z) {
    c.x = c.tx = x; c.y = c.ty = y;
    place(c.el, x, y);
    c.el.style.zIndex = String(z ?? (100 + Math.round(y * 10)));
  }

  function place(el, x, y) { el.style.left = (x * U).toFixed(1) + 'px'; el.style.top = (y * U).toFixed(1) + 'px'; }
  function resize() {
    if (!built) return;
    U = Math.max(56, Math.min(100, Math.min(innerWidth, innerHeight) / 8.4));
    document.documentElement.style.setProperty('--u', U + 'px');
    world.style.width = W * U + 'px'; world.style.height = H * U + 'px';
    const box = (el, x, y, w, h) => { place(el, x, y); el.style.width = w * U + 'px'; el.style.height = h * U + 'px'; };
    for (const il of islands) box(il.el, il.x, il.y, il.w, il.h);
    for (const r of roadEls) box(r.el, ...r.r);
    for (const p of plazaEls) box(p.el, p.p[0] - p.p[2], p.p[1] - p.p[2], p.p[2] * 2, p.p[2] * 2);
    for (const a of attrs.values()) if (a.el) { place(a.el, a.x, a.y); place(a.booth, a.x, a.y); }
    for (const p of props) { place(p.el, p.x, p.y); if (p.el.dataset.w) p.el.style.width = +p.el.dataset.w * U + 'px'; }
    for (const k of keys) { place(k.el, k.x, k.y); k.el.style.width = (k.w * U).toFixed(1) + 'px'; k.el.style.height = (k.h * U).toFixed(1) + 'px'; }
    if (toyHub) toyHub.resize(U);
    for (const c of [me, ...peers.values()]) if (c) place(c.el, c.x, c.y);
    cam.snap = true;
  }

  const viewW = () => Math.max(200, innerWidth - (jump && jump.offsetWidth ? jump.offsetWidth + 14 : 0));
  function camera(dt) {
    const vw = viewW() / U, vh = innerHeight / U;
    const clamp = (v, size, vw0) => size <= vw0 ? size / 2 : Math.max(vw0 / 2 - 0.3, Math.min(size - vw0 / 2 + 0.3, v));
    const gx = clamp(me.x, W, vw), gy = clamp(me.y, H, vh);
    if (cam.snap) { cam.x = gx; cam.y = gy; cam.snap = false; }
    else { const k = Math.min(1, dt * (me.ride ? 7.5 : 4.2)); cam.x += (gx - cam.x) * k; cam.y += (gy - cam.y) * k; }
    world.style.transform = `translate3d(${(viewW() / 2 - cam.x * U).toFixed(1)}px, ${(innerHeight / 2 - cam.y * U).toFixed(1)}px, 0)`;
  }
  const toWorld = (cx, cy) => [cam.x + (cx - viewW() / 2) / U, cam.y + (cy - innerHeight / 2) / U];
  const inWorld = (x, y) => [Math.max(0.4, Math.min(W - 0.4, x)), Math.max(0.6, Math.min(H - 0.3, y))];
  const r2 = (v) => Math.round(v * 100) / 100;

  function step(c, dt) {
    if (c.ride) return false;
    const dx = c.tx - c.x, dy = c.ty - c.y, d = Math.hypot(dx, dy);
    const sp = Math.max(4.6, d / 1.45);
    if (d > 0.001) {
      const m = Math.min(d, sp * dt);
      c.x += dx / d * m; c.y += dy / d * m;
      if (Math.abs(dx) > 0.05) c.face = dx < 0 ? -1 : 1;
    }
    const walking = d > 0.02;
    c.el.classList.toggle('walk', walking);
    c.el.style.setProperty('--face', c.face);
    c.el.style.zIndex = String(100 + Math.round(c.y * 10));
    place(c.el, c.x, c.y);
    return walking;
  }

  function arrive() {
    const f = me.enter; me.enter = null;
    if (!f || entering) return;
    entering = true;
    me.el.classList.remove('hop'); void me.el.offsetWidth; me.el.classList.add('hop');
    try { deps.Sfx.tone(520, 0.12, 'sine', 0.2, 0, 900); } catch (e) {}
    setTimeout(() => { entering = false; lastIn = f; savePos(); deps.Shell.open(f, { announce: true }); }, 320);
    setTimeout(() => me && me.el.classList.remove('hop'), 1500);
  }

  function startDrag() {
    hold.drag = true;
    if (hold.attr) { const a = attrs.get(hold.attr); if (a && a.el) a.el.classList.remove('pressed'); }
    if (me.ride) dismount(me, true);
    me.enter = null;
  }
  function endHold(e, cancel) {
    if (!hold || e.pointerId !== hold.id) return;
    const h = hold; hold = null;
    if (h.attr) { const a = attrs.get(h.attr); if (a && a.el) a.el.classList.remove('pressed'); }
    if (cancel || !active) return;
    if (h.drag) { go(me.tx, me.ty, null); return; }
    if (h.attr) { const a = attrs.get(h.attr); go(a.x, a.y + 0.05, h.attr); return; }
    const [x, y] = toWorld(h.x, h.y);
    const c = chrAt(x, y);
    if (c) { hopChr(c, true); if (deps.Multi.group) deps.Multi.send({ a: 'g', i: 3, m: [r2(c.x), r2(c.y)] }, 0); return; }
    // のっていない ときに おおきな ゆうぐを タップしたら、のりば まで あるいて のる
    const wasRiding = !!me.ride;
    if (!wasRiding && toyHub) {
      const bp = toyHub.boardPoint(x, y);
      if (bp) { ripple(bp[0], bp[1]); go(bp[0], bp[1], null); return; }
    }
    ripple(x, y);
    go(x, y, null);
  }
  function holdTick(now) {
    if (!hold) return;
    if (!hold.drag && now - hold.t0 > 380) startDrag();
    if (hold.drag) {
      if (me.ride) dismount(me, true, now);
      const [x, y] = inWorld(...toWorld(hold.x, hold.y));
      me.tx = x; me.ty = y;
      if (deps.Multi.group) deps.Multi.send({ a: 'g', i: 1, m: [r2(x), r2(y)] }, 150);
    }
  }
  function go(x, y, enter) {
    if (me.ride) dismount(me, true);
    [x, y] = inWorld(x, y);
    me.tx = x; me.ty = y; me.enter = enter;
    if (deps.Multi.group) deps.Multi.send({ a: 'g', i: 1, m: [r2(x), r2(y)] }, 0);
  }
  function ripple(x, y) {
    const r = document.createElement('i');
    r.className = 'ripple'; place(r, x, y); world.appendChild(r);
    setTimeout(() => r.remove(), 600);
  }
  function warpTo(x, y) {
    if (!me) return;
    if (me.ride) dismount(me, true);
    poof(me.x, me.y);
    [me.x, me.y] = inWorld(x, y); me.tx = me.x; me.ty = me.y; me.enter = null;
    poof(me.x, me.y);
    try { deps.Sfx.tone(700, 0.15, 'triangle', 0.2, 0, 1300); } catch (e) {}
    snapshot();
  }
  function warp(gi) {
    const il = islands.find(i => i.gi === gi);
    if (il) warpTo(...areaFront(il));
  }
  function warpZone(name) {
    if (name === 'left' && zones) warpTo(zones.left.cx, zones.left.y + 1.8);
    else if (name === 'right' && zones) warpTo(zones.right.cx, zones.right.y + 1.8);
    else if (name === 'castle') warpTo(BX, H - 1.8);
  }
  function poof(x, y) {
    const p = document.createElement('i');
    p.className = 'poof'; p.textContent = '✨'; place(p, x, y); world.appendChild(p);
    setTimeout(() => p.remove(), 700);
  }
  function snapshot() {
    if (!me || !deps || !deps.Multi.group) return;
    deps.Multi.send({ a: 'g', i: 2, m: [r2(me.x), r2(me.y), r2(me.tx), r2(me.ty)] }, 0);
    if (me.ride) deps.Multi.send({ a: 'g', i: 5, m: [me.ride.id, me.ride.slot] }, 0);
  }

  const chrList = () => me ? [me, ...[...peers.values()].filter(c => !c.el.hidden)] : [];
  function chrAt(x, y) {
    let best = null, bd = 0.6;
    for (const c of chrList()) { const d = Math.hypot(c.x - x, c.y - 0.4 - y); if (d < bd) { bd = d; best = c; } }
    return best;
  }
  function nearestChr(x, y, r) {
    let best = null, bd = r;
    for (const c of chrList()) { const d = Math.hypot(c.x - x, c.y - y); if (d < bd) { bd = d; best = c; } }
    return best;
  }
  function hopChr(c, loud) {
    c.el.classList.remove('jump'); void c.el.offsetWidth; c.el.classList.add('jump');
    clearTimeout(c.jt); c.jt = setTimeout(() => c.el.classList.remove('jump'), 600);
    try { deps.Sfx.tone(380, 0.25, 'triangle', loud ? 0.25 : 0.15, 0, 900); } catch (e) {}
  }

  function tone(c, f, d, type, v, to) { try { deps.Sfx.tone(f, d, type, c === me ? v : v * 0.45, 0, to ?? null); } catch (e) {} }
  function burst(x, y, col, big) {
    const f = document.createElement('i');
    f.className = 'fw' + (big ? ' big' : ''); f.style.setProperty('--fc', col);
    const n = big ? 16 : 12;
    for (let k = 0; k < n; k++) { const d = document.createElement('i'); d.style.setProperty('--a', (k * 360 / n) + 'deg'); f.appendChild(d); }
    place(f, x, y); world.appendChild(f);
    setTimeout(() => f.remove(), big ? 1450 : 1100);
  }
  function enter(sp, c, now, all) {
    const duoCastle = sp.type === 'castle' && all && all.filter(ch => Math.hypot(sp.x - ch.x, sp.y - ch.y) < sp.r + 0.65).length >= 2;
    if (duoCastle) {
      if (now - (sp.duoT || 0) < 3500) return;
      sp.duoT = sp.t = now;
      const rb = document.createElement('i');
      rb.className = 'rainbow'; place(rb, sp.x, sp.y - 0.8); world.appendChild(rb);
      setTimeout(() => rb.remove(), 3900);
      const cols = ['#ff5a8a', '#ffd23f', '#4fc3f7', '#b388ff', '#8fce73', '#ff9f1c'];
      [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(c, f, 0.28, 'triangle', 0.16), i * 110));
      for (let i = 0; i < 10; i++) setTimeout(() => {
        burst(sp.x + (Math.random() - 0.5) * 4.6, sp.y - 2.6 - Math.random() * 2.1, cols[i % cols.length], i % 2 === 0);
        tone(c, 190 + Math.random() * 140, 0.28, 'sawtooth', 0.08, 75);
        tone(c, 1100 + Math.random() * 550, 0.26, 'sine', 0.11, 1850);
      }, i * 210);
      for (const ch of all) if (Math.hypot(sp.x - ch.x, sp.y - ch.y) < sp.r + 0.65) hopChr(ch, ch === me);
      return;
    }
    if (now - (sp.t || 0) < 1200 && sp.type !== 'balloon') return;
    sp.t = now;
    if (sp.type === 'fountain') {
      for (let i = 0; i < 10; i++) {
        const d = document.createElement('i');
        d.className = 'drop'; d.textContent = '💧';
        d.style.setProperty('--dx', ((Math.random() - 0.5) * 2.4).toFixed(2));
        d.style.setProperty('--dy', (-1.2 - Math.random() * 1.2).toFixed(2));
        d.style.animationDelay = (i * 0.04).toFixed(2) + 's';
        place(d, sp.x, sp.y - 0.6); world.appendChild(d);
        setTimeout(() => d.remove(), 1300);
      }
      for (let i = 0; i < 5; i++) tone(c, 900 + Math.random() * 700, 0.07, 'sine', 0.12, 400 + Math.random() * 300);
    } else if (sp.type === 'balloon') {
      if (c.itemKind === 'balloon') return;
      equip(c, 'balloon', '🎈', true);
      tone(c, 600, 0.2, 'sine', 0.2, 1200);
    } else if (sp.type === 'wheel') {
      sp.el.classList.remove('turn'); void sp.el.offsetWidth; sp.el.classList.add('turn');
      [784, 988, 1175].forEach((f, i) => setTimeout(() => tone(c, f, 0.25, 'sine', 0.13), i * 160));
    } else if (sp.type === 'castle') {
      for (let i = 0; i < 4; i++) setTimeout(() => {
        burst(sp.x + (Math.random() - 0.5) * 3, sp.y - 3.2 - Math.random() * 1.2, ['#ff5a8a', '#ffd23f', '#4fc3f7', '#b388ff'][i], false);
        tone(c, 200 + Math.random() * 120, 0.3, 'sawtooth', 0.08, 80);
        tone(c, 1200 + Math.random() * 400, 0.25, 'sine', 0.1, 1800);
      }, i * 260);
    }
  }
  function spotTick(all, now) {
    for (const c of all) {
      if (c.ride) { c.el.classList.remove('boing', 'spin'); continue; }
      const on = c.on || (c.on = new Set());
      let tramp = false, kuru = false;
      for (const sp of spots) {
        const inside = Math.hypot(sp.x - c.x, sp.y - c.y) < sp.r;
        if (inside && sp.type === 'tramp') tramp = true;
        if (inside && sp.type === 'kuru') kuru = true;
        if (inside && !on.has(sp)) { on.add(sp); enter(sp, c, now, all); }
        else if (!inside) on.delete(sp);
      }
      c.el.classList.toggle('boing', tramp);
      if (tramp && now - (c.boT || 0) > 620) { c.boT = now; tone(c, 300, 0.22, 'triangle', 0.22, 760); }
      if (!tramp) c.boT = 0;
      c.el.classList.toggle('spin', kuru);
      if (kuru && now - (c.kuT || 0) > 900) { c.kuT = now; const n = [523, 659, 784, 659][Math.floor(now / 900) % 4]; tone(c, n, 0.18, 'sine', 0.14); }
    }
  }

  function setSky(idx, opts = {}) {
    skyIdx = ((idx % SKIES.length) + SKIES.length) % SKIES.length;
    const [mode, icon] = SKIES[skyIdx];
    document.documentElement.dataset.sky = mode;
    if (skyBtn) skyBtn.textContent = icon;
    if (opts.sound) {
      const ch = [[523, 659, 784], [440, 554, 659], [659, 784, 1047]][skyIdx];
      ch.forEach((f, i) => setTimeout(() => { try { deps.Sfx.tone(f, 0.24, 'sine', 0.14); } catch (e) {} }, i * 85));
    }
    if (opts.send && deps && deps.Multi.group) deps.Multi.send({ a: 'g', i: 4, m: [skyIdx, 0] }, 0);
  }

  const PIANO = [
    [523.25, '#ff5a7e', '#c93356'], [587.33, '#ff9f1c', '#c47200'], [659.25, '#ffd23f', '#c79b0b'],
    [698.46, '#7ed957', '#4ea02d'], [783.99, '#4fc3f7', '#1d86b8'], [880.00, '#5c8aff', '#3057bd'],
    [987.77, '#a876ff', '#6d40bd'], [1046.5, '#ff7eb6', '#c44680'],
  ];
  function addPianoRoad(cx, cy) {
    const kw = 0.38, gap = 0.05, stepX = kw + gap, x0 = cx - (PIANO.length - 1) * stepX / 2;
    PIANO.forEach(([f, kc, kd], i) => {
      const el = document.createElement('i');
      el.className = 'pkey';
      el.style.setProperty('--kc', kc); el.style.setProperty('--kd', kd);
      world.appendChild(el);
      keys.push({ el, x: x0 + i * stepX, y: cy, w: kw, h: 1.05, f, col: kc, i });
    });
  }
  function pianoTick(all) {
    const lit = new Set();
    for (const c of all) {
      if (c.ride) { c.pk = null; continue; }
      let hit = null;
      for (const k of keys) {
        if (Math.abs(c.x - k.x) < k.w * 0.56 && Math.abs(c.y - k.y) < k.h * 0.62) { hit = k; break; }
      }
      if (hit) lit.add(hit);
      if (hit && c.pk !== hit) {
        tone(c, hit.f, 0.3, 'triangle', 0.22);
        tone(c, hit.f * 2, 0.16, 'sine', 0.06);
        const n = document.createElement('i');
        n.className = 'pnote'; n.textContent = hit.i % 2 ? '🎶' : '🎵';
        place(n, hit.x, hit.y - 0.55); world.appendChild(n);
        setTimeout(() => n.remove(), 950);
      }
      c.pk = hit;
    }
    for (const k of keys) k.el.classList.toggle('on', lit.has(k));
  }

  function makePath(pts) {
    const cum = [0];
    for (let i = 1; i <= pts.length; i++) {
      const a = pts[i - 1], b = pts[i % pts.length];
      cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    return { pts, cum, len: cum[cum.length - 1] };
  }
  function pathAt(path, dist) {
    const L = path.len, d = ((dist % L) + L) % L, cum = path.cum, pts = path.pts;
    let lo = 0, hi = pts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid - 1; }
    const a = pts[lo], b = pts[(lo + 1) % pts.length], seg = Math.max(1e-6, cum[lo + 1] - cum[lo]), t = (d - cum[lo]) / seg;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, b[0] - a[0], b[1] - a[1]];
  }
  function buildTrains() {
    const yTop = plazas[0][1], yBot = plazas[plazas.length - 1][1], R = 1.28;
    const bulgeY = (y) => {
      let b = 0;
      for (const [, py] of plazas) {
        const d = Math.abs(y - py);
        if (d < 2.0) { const c = Math.cos(d / 2.0 * Math.PI / 2); b = Math.max(b, 0.56 * c * c); }
      }
      return b;
    };
    const bulgeX = (x, mag) => {
      const d = Math.abs(x - BX);
      if (d >= 2.2) return 0;
      const c = Math.cos(d / 2.2 * Math.PI / 2);
      return mag * c * c;
    };

    // ろせん 1: おおどおり・おしろ ループ
    const pBlv = (() => {
      const pts = [], n = 64;
      for (let i = 0; i <= n; i++) { const y = yTop + (yBot - yTop) * (i / n); pts.push([BX - 0.72 - bulgeY(y), y]); }
      for (let i = 1; i < 20; i++) { const a = Math.PI - (i / 20) * Math.PI; pts.push([BX + Math.cos(a) * R, yBot + Math.sin(a) * R]); }
      for (let i = 0; i <= n; i++) { const y = yBot - (yBot - yTop) * (i / n); pts.push([BX + 0.72 + bulgeY(y), y]); }
      for (let i = 1; i < 20; i++) { const a = (i / 20) * Math.PI; pts.push([BX + Math.cos(a) * R, yTop - Math.sin(a) * R]); }
      return makePath(pts);
    })();

    // ろせん 2: えんない ぐるっと 1しゅう（いりぐち → ひだりゾーン → おしろ → みぎゾーン）
    const pGrand = (() => {
      const pts = [], nx = 50, ny = 60;
      // うえの みち（みぎ → ひだり、ひろばを きたへ よける）
      for (let i = 0; i <= nx; i++) { const x = XR - (XR - XL) * (i / nx); pts.push([x, yTop - bulgeX(x, 1.25)]); }
      // ひだり ゾーン ぞい（うえ → した）
      for (let i = 1; i <= ny; i++) { const y = yTop + (yBot - yTop) * (i / ny); pts.push([XL, y]); }
      // したの みち（ひだり → みぎ、おしろの まえを みなみへ よける）
      for (let i = 1; i <= nx; i++) { const x = XL + (XR - XL) * (i / nx); pts.push([x, yBot + bulgeX(x, 1.25)]); }
      // みぎ ゾーン ぞい（した → うえ）
      for (let i = 1; i < ny; i++) { const y = yBot - (yBot - yTop) * (i / ny); pts.push([XR, y]); }
      return makePath(pts);
    })();

    // ろせん 3・4: とうざい シャトル（ひだりゾーン ↔ おおどおり ↔ みぎゾーン を よこみちで おうふく）
    const makeShuttle = (yMid) => {
      const pts = [], nx = 44, r = 0.34;
      for (let i = 0; i <= nx; i++) { const x = XL + (XR - XL) * (i / nx); pts.push([x, yMid - r - bulgeX(x, 1.0)]); }
      for (let i = 1; i < 10; i++) { const a = -Math.PI / 2 + (i / 10) * Math.PI; pts.push([XR + Math.cos(a) * r, yMid + Math.sin(a) * r]); }
      for (let i = 0; i <= nx; i++) { const x = XR - (XR - XL) * (i / nx); pts.push([x, yMid + r + bulgeX(x, 1.0)]); }
      for (let i = 1; i < 10; i++) { const a = Math.PI / 2 + (i / 10) * Math.PI; pts.push([XL + Math.cos(a) * r, yMid + Math.sin(a) * r]); }
      return makePath(pts);
    };

    const specs = [
      { name: 'blv-1',   path: pBlv,                      period: 44000, phase: 0.00, theme: 'tr-0' },
      { name: 'blv-2',   path: pBlv,                      period: 44000, phase: 0.50, theme: 'tr-1' },
      { name: 'grand-1', path: pGrand,                    period: 84000, phase: 0.00, theme: 'tr-2' },
      { name: 'grand-2', path: pGrand,                    period: 84000, phase: 0.50, theme: 'tr-3' },
      { name: 'mid-1',   path: makeShuttle(plazas[1][1]), period: 36000, phase: 0.15, theme: 'tr-4' },
      { name: 'mid-2',   path: makeShuttle(plazas[2][1]), period: 36000, phase: 0.65, theme: 'tr-5' },
    ];
    specs.forEach((sp, ti) => {
      const cars = [['loco', '🚂'], ['c1', '🚃'], ['c2', '🚃']].map(([cls, em]) => {
        const el = document.createElement('div');
        el.className = `pcar ${cls} ${sp.theme}`;
        el.innerHTML = (cls === 'loco' ? '<i class="pbeam"></i>' : '') + `<i class="pshad"></i><b><span>${em}</span></b>`;
        world.appendChild(el);
        return { el, dir: 1, x: BX, y: yTop };
      });
      trains.push({ idx: ti, name: sp.name, path: sp.path, period: sp.period, phase: sp.phase, cars, tootT: 0, puffT: ti * 200, x: BX, y: yTop });
    });
  }
  function puff(x, y, em) {
    const p = document.createElement('i');
    p.className = 'puff'; p.textContent = em;
    p.style.setProperty('--px', ((Math.random() - 0.5) * 0.9).toFixed(2));
    place(p, x, y); world.appendChild(p);
    setTimeout(() => p.remove(), 950);
  }
  function trainTick(all, now) {
    if (!trains.length) return;
    const tMs = Date.now();
    for (const tr of trains) {
      const headD = (((tMs / tr.period) + tr.phase) % 1) * tr.path.len;
      tr.cars.forEach((car, i) => {
        const [x, y, dx, dy] = pathAt(tr.path, headD - i * 0.95);
        car.x = x; car.y = y;
        if (Math.abs(dx) > Math.abs(dy) * 0.45 && Math.abs(dx) > 0.01) car.dir = dx > 0 ? -1 : 1;
        car.el.style.setProperty('--dir', car.dir);
        car.el.style.zIndex = String(100 + Math.round(y * 10));
        place(car.el, x, y);
      });
      const loco = tr.cars[0];
      tr.x = loco.x; tr.y = loco.y;
      const inView = Math.abs(loco.x - cam.x) < 10 && Math.abs(loco.y - cam.y) < 8;
      if (inView && now - tr.puffT > 1200) { tr.puffT = now; puff(loco.x, loco.y - 0.65, '💨'); }

      // どの トレイン にも のれる！（slot = trainIdx * 3 + carIdx）
      if (me && !me.ride && now > (me.dismountUntil || 0)) {
        const reach = Math.hypot(me.tx - me.x, me.ty - me.y) < 0.45 ? 1.35 : 0.85;
        const hit = tr.cars.find(car => Math.hypot(car.x - me.x, car.y - me.y) < reach);
        if (hit) {
          const used = new Set(all.filter(ch => ch.ride && ch.ride.id === 5).map(ch => ch.ride.slot));
          const s1 = tr.idx * 3 + 1, s2 = tr.idx * 3 + 2;
          board(me, 5, !used.has(s1) ? s1 : s2, true);
          tone(me, 587, 0.16, 'triangle', 0.2);
          setTimeout(() => tone(me, 784, 0.28, 'triangle', 0.2), 160);
        }
      }
      // ちかづくと ポッポー！
      let nearC = null;
      for (const c of all) if (!c.ride && Math.hypot(loco.x - c.x, loco.y - c.y) < 1.45) { nearC = c; break; }
      if (nearC && now - tr.tootT > 2600) {
        tr.tootT = now;
        loco.el.classList.remove('toot'); void loco.el.offsetWidth; loco.el.classList.add('toot');
        setTimeout(() => loco.el.classList.remove('toot'), 600);
        puff(loco.x - 0.2, loco.y - 0.7, '💨');
        setTimeout(() => puff(loco.x + 0.25, loco.y - 0.85, '🎵'), 120);
        tone(nearC, 587, 0.16, 'triangle', 0.2);
        setTimeout(() => tone(nearC, 784, 0.28, 'triangle', 0.2), 180);
      }
    }
    for (const c of all) {
      if (c.ride && c.ride.id === 5) {
        const ti = Math.floor(c.ride.slot / 3) % trains.length;
        const ci = (c.ride.slot % 3) || 1;
        const car = trains[ti].cars[ci] || trains[ti].cars[1];
        setRidePos(c, car.x, car.y - 0.22, 100 + Math.round(car.y * 10) + 5);
      }
    }
  }

  function greet(all, now) {
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      if (a.ride || b.ride) continue;
      const key = [a, b].map(c => c === me ? 'me' : c.av).sort().join('|');
      const d = Math.hypot(a.x - b.x, a.y - b.y), st = near.get(key) || { on: false, t: 0 };
      if (!st.on && d < 0.95 && now - st.t > 3000) {
        st.on = true; st.t = now;
        for (const c of [a, b]) { c.el.classList.remove('hi'); void c.el.offsetWidth; c.el.classList.add('hi'); setTimeout(() => c.el.classList.remove('hi'), 700); }
        const h = document.createElement('i');
        h.className = 'heart'; h.textContent = ['💕', '✨', '👋', '💖'][Math.floor(Math.random() * 4)];
        place(h, (a.x + b.x) / 2, Math.min(a.y, b.y) - 0.9); world.appendChild(h);
        setTimeout(() => h.remove(), 1100);
        try { deps.Sfx.tone(660, 0.12, 'sine', 0.18, 0, 990); deps.Sfx.tone(880, 0.16, 'sine', 0.15, 0.12, 1320); } catch (e) {}
      } else if (st.on && d > 1.4) st.on = false;
      near.set(key, st);
    }
  }

  function onAct(msg) {
    if (!built || !Array.isArray(msg.m) || msg.m.length < 2 || typeof msg.from !== 'string') return;
    const v = msg.m.map(n => +n || 0);
    if (msg.i === 4) { setSky(v[0], { sound: active && !v[1] }); return; }
    let c = peers.get(msg.from);
    if (!c) { c = makeChr(AVS.has(msg.av) ? msg.av : '🧒', msg.hu, false); c.x = c.tx = v[0]; c.y = c.ty = v[1]; peers.set(msg.from, c); }
    setAv(c, AVS.has(msg.av) ? msg.av : '🧒', msg.hu);
    c.el.hidden = false;
    if (msg.i === 5) {
      if (v[0] > 0) board(c, v[0], v[1], false);
      else dismount(c, false);
      return;
    }
    if (msg.i === 3) { const t = nearestChr(v[0], v[1], 1.2); if (t) hopChr(t, false); return; }
    if (c.ride) dismount(c, false);
    if (msg.i === 1) { [c.tx, c.ty] = inWorld(v[0], v[1]); }
    else if (msg.i === 2) {
      const [x, y] = inWorld(v[0], v[1]);
      if (Math.hypot(x - c.x, y - c.y) > 2.5) { if (active) poof(c.x, c.y); c.x = x; c.y = y; if (active) poof(x, y); }
      [c.tx, c.ty] = inWorld(v[2] ?? x, v[3] ?? y);
    }
  }
  function onMembers(list) {
    if (!built) return;
    for (const [id, c] of peers) {
      const m = list.find(m => m.id === id);
      if (!m) { c.el.remove(); peers.delete(id); }
      else c.el.hidden = m.p !== '';
    }
    for (const m of list) if (m.p === '' && !peers.has(m.id)) {
      const c = makeChr(AVS.has(m.av) ? m.av : '🧒', m.hu, false);
      const [sx, sy] = spawnAt();
      c.x = c.tx = sx + (Math.random() - 0.5); c.y = c.ty = sy;
      peers.set(m.id, c);
    }
    const came = list.some(m => m.p === '' && wasAt.get(m.id) !== '');
    wasAt.clear(); for (const m of list) wasAt.set(m.id, m.p);
    if (active && came && deps.Shell.here === '') setTimeout(() => { snapshot(); if (skyIdx) deps.Multi.send({ a: 'g', i: 4, m: [skyIdx, 1] }, 0); }, 100);
  }

  function savePos() { if (me) try { sessionStorage.setItem('world-pos', JSON.stringify([r2(me.x), r2(me.y)])); } catch (e) {} }

  function loop(now) {
    if (!active) { rafId = 0; return; }
    rafId = requestAnimationFrame(loop);
    if (document.documentElement.classList.contains('playing') || !me) { last = now; return; }
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
    holdTick(now);
    setAv(me, deps.Multi.myAvatar, deps.Multi.myHue);
    const walking = step(me, dt);
    if (!walking && me.enter) arrive();
    for (const c of peers.values()) if (!c.el.hidden) step(c, dt);
    const all = chrList();
    spotTick(all, now);
    pianoTick(all);
    trainTick(all, now);
    if (toyHub) toyHub.tick(all, now, dt);
    greet(all, now);
    camera(dt);
    let best = 0, bd = 1e9;
    islands.forEach((il, i) => { const d = Math.hypot(il.x + il.w / 2 - me.x, il.y + il.h / 2 - me.y); if (d < bd) { bd = d; best = i; } });
    if (best !== curIsl) {
      curIsl = best;
      if (jump) [...jump.children].forEach((b) => b.classList.toggle('on', +b.dataset.gi === islands[best].gi));
      deps.Shell.sec(islands[best].gi);
    }
  }

  function build() {
    if (built) return;
    built = true;
    view = document.getElementById('view');
    world = document.getElementById('world');
    jump = document.getElementById('jump');

    layout();
    for (const r of roads) { const el = document.createElement('i'); el.className = 'road'; world.appendChild(el); roadEls.push({ el, r }); }
    for (const p of plazas) { const el = document.createElement('i'); el.className = 'plaza'; world.appendChild(el); plazaEls.push({ el, p }); }
    for (const il of islands) {
      const el = document.createElement('div');
      el.className = 'island'; el.style.setProperty('--bg', il.g.bg); el.style.setProperty('--bd', il.g.bd);
      world.appendChild(el); il.el = el;
    }
    decorate();
    if (islands[0]) addPianoRoad((islands[0].x + islands[0].w / 2 + 1.05 + (BX - 1.9)) / 2, GATE + AV / 2);
    if (islands[5]) addPianoRoad((BX + 1.9 + (islands[5].x + islands[5].w / 2 - 1.05)) / 2, islands[5].y - AV / 2);
    buildTrains();

    if (window.ParkToys) {
      toyHub = ParkToys.build({
        world, zones, place, addProp, arch, lamp, tone, equip, hopChr,
        board, dismount, canBoard, setRidePos,
        me: () => me, U: () => U, isNight: () => SKIES[skyIdx][0] === 'night',
      });
    }

    exitBtn = document.createElement('button');
    exitBtn.id = 'park-exit'; exitBtn.textContent = '🏠'; exitBtn.setAttribute('aria-label', 'ふつうの ホーム');
    deps.onTap(exitBtn, () => { deps.Sfx.pop(); deps.onExit(); });
    document.body.appendChild(exitBtn);

    skyBtn = document.createElement('button');
    skyBtn.id = 'sky'; skyBtn.setAttribute('aria-label', 'そら');
    deps.onTap(skyBtn, () => setSky(skyIdx + 1, { sound: true, send: true }));
    document.body.appendChild(skyBtn);
    setSky(0);

    warpBar = document.createElement('div');
    warpBar.id = 'park-warps';
    [
      ['left',   '🦄', '#dff4ff', '#65b8f5', 'ひだり ゆうえんち'],
      ['right',  '🍿', '#fff0db', '#ff9f43', 'みぎ ゆうえんち'],
      ['castle', '🏰', '#f3e5ff', '#b388ff', 'おしろ'],
    ].forEach(([key, em, bg, bd, label]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.zone = key; b.textContent = em; b.setAttribute('aria-label', label);
      b.style.setProperty('--bg', bg); b.style.setProperty('--bd', bd);
      deps.onTap(b, () => { deps.Sfx.pop(); warpZone(key); });
      warpBar.appendChild(b);
    });
    document.body.appendChild(warpBar);

    for (const a of attrs.values()) {
      const p = deps.byFile[a.file];
      if (!p || (p[4] && !deps.can[p[4]])) continue;
      const [file, emoji, c1, c2] = p;
      const el = document.createElement('a');
      el.href = file + '.html'; el.className = 'big-btn attr'; el.dataset.f = file; el.draggable = false;
      el.style.setProperty('--c1', c1); el.style.setProperty('--c2', c2);
      el.style.zIndex = String(100 + Math.round(a.y * 10) - 3);
      const bo = document.createElement('div');
      bo.className = 'booth'; bo.style.setProperty('--c1', c1); bo.style.setProperty('--c2', c2);
      bo.innerHTML = '<i class="floor"></i><i class="poles"></i><i class="roof"></i>';
      bo.style.zIndex = String(100 + Math.round(a.y * 10) - 4);
      world.appendChild(bo); a.booth = bo;
      el.innerHTML = `<span class="emoji">${emoji}</span>`;
      el.addEventListener('click', (e) => e.preventDefault());
      if (!deps.seen.has(file)) el.classList.add('new');
      world.appendChild(el); a.el = el;
      const pg = deps.Shell.pages.get(file);
      if (pg) pg.pel = el;
    }

    me = makeChr(deps.Multi.myAvatar, deps.Multi.myHue, true);
    let pos = null;
    try { pos = JSON.parse(sessionStorage.getItem('world-pos')); } catch (e) {}
    [me.x, me.y] = Array.isArray(pos) ? pos.map(Number) : spawnAt();
    me.tx = me.x; me.ty = me.y;

    view.addEventListener('pointerdown', (e) => {
      if (!active || hold || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const a = e.target.closest && e.target.closest('a.attr');
      hold = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now(), attr: a ? a.dataset.f : '', drag: false };
      if (a) { deps.Sfx.pop(); deps.Shell.look(a.dataset.f); a.classList.add('pressed'); }
    });
    view.addEventListener('touchmove', (e) => { if (active) e.preventDefault(); }, { passive: false });
    addEventListener('pointermove', (e) => {
      if (!hold || e.pointerId !== hold.id) return;
      hold.x = e.clientX; hold.y = e.clientY;
      if (!hold.drag && Math.hypot(hold.x - hold.x0, hold.y - hold.y0) > 14) startDrag();
    });
    addEventListener('pointerup', (e) => endHold(e, false));
    addEventListener('pointercancel', (e) => endHold(e, true));
    addEventListener('resize', () => { if (active) resize(); });
    addEventListener('pagehide', () => savePos());
    addEventListener('iro-home', () => {
      if (!built) return;
      if (me && me.ride) dismount(me, false);
      const a = attrs.get(lastIn) || null;
      if (a) { me.x = me.tx = a.x; me.y = me.ty = a.y + 0.85; me.enter = null; }
      me.el.classList.remove('hop');
      lastIn = ''; cam.snap = true; savePos();
      if (active) setTimeout(snapshot, 300);
    });

    resize();
    onMembers(deps.Shell.members());
    window.World = api;
  }

  const api = {
    get me() { return me; },
    get peers() { return peers; },
    attrs, islands, props, spots, keys, trains,
    get train() { return trains[0]; },
    get zones() { return zones; },
    get toys() { return toyHub; },
    get sky() { return SKIES[skyIdx][0]; },
    setSky: (i) => setSky(i, { sound: true, send: true }),
    get U() { return U; },
    toWorld, warp, warpZone, go,
    dismount: () => me && dismount(me, true),
  };

  return {
    init(d) { deps = d; },
    activate() {
      if (!deps) return;
      build();
      active = true; curIsl = -1; last = performance.now();
      resize();
      if (!rafId) rafId = requestAnimationFrame(loop);
      setTimeout(() => { snapshot(); if (skyIdx && deps.Multi.group) deps.Multi.send({ a: 'g', i: 4, m: [skyIdx, 1] }, 0); }, 100);
    },
    deactivate() {
      active = false; hold = null;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      savePos();
    },
    warp,
    warpZone,
    onAct,
    onMembers,
    onEntered(p) { if (p) lastIn = p; },
    get active() { return active; },
    get world() { return api; },
  };
})();
