// いろいろボタン 共通マルチプレイ（WebSocket / Cloudflare Workers + Durable Objects 対応）
//
// しくみ:
//   ・メニュー（index.html）が「いれもの（シェル）」で、ボタンの ページは その中の iframe で ひらく。
//   ・せつぞくは シェルが 1本だけ もつ。ページを いききしても きれない。
//   ・ページ側の Multi は シェルに たのむだけ（つかいかたは いままでと おなじ）。
//
// ページでの つかいかた:
//   Multi.join('hanabi', (msg) => { ... }, (state) => { ... });
//   Multi.send({ a: 'fire', x: 0.5, y: 0.3 });
//   Multi.showPeer(msg, x, y); // 相手の動物アイコンと波紋をふわっと表示
//
// 部屋:
//   ・?room=kazuki のように 合言葉を つけて ひらくと 家族の グループ部屋（この きかいに おぼえる。?room= で けす）。
//     グループ部屋では メニューも ふくめて ずっと つながり、だれかが ボタンに はいると みんな いっしょに いどうする。
//   ・合言葉なしの ときは いままで どおり、マルチ たいおうの ページに いる あいだだけ そのページの 部屋に つながる。
//   ・?ws=ws://localhost:8787 で 開発用サーバーに つなぐ（このタブの あいだだけ）。
//   ・オフラインやサーバー未設定時はそのまま1人プレイとして動く。

const Multi = (() => {
  const SAFE_AVATARS = new Set(['🐶', '🐱', '🐰', '🐻', '🐼', '🐸', '🦊', '🐧', '🐷', '🐥', '🦁', '🐨', '🧒']);
  const safeAvatar = (v) => (typeof v === 'string' && SAFE_AVATARS.has(v)) ? v : '🧒';

  // 全端末で同じ乱数列を作るためのシード付き PRNG（Mulberry32）
  function seed() { return Math.floor(Math.random() * 2147483646) + 1; }
  function rng(s) {
    let a = (s >>> 0) || 1;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function injectStyle(document = window.document) {
    if (document.getElementById('multi-style')) return;
    const st = document.createElement('style');
    st.id = 'multi-style';
    st.textContent = `
      .multi-pill {
        position: fixed; top: calc(max(12px, env(safe-area-inset-top)) + 54px); right: max(12px, env(safe-area-inset-right));
        z-index: 1010; border: none; border-radius: 999px; background: rgba(255,255,255,.92); color: #333;
        font-family: inherit; font-size: 16px; font-weight: bold; padding: 6px 12px;
        box-shadow: 0 4px 0 rgba(0,0,0,.18); cursor: pointer; display: inline-flex; align-items: center; gap: 5px;
        transition: opacity .25s, transform .08s, box-shadow .25s;
      }
      .multi-pill[hidden] { display: none; }
      .multi-pill::after { content: ''; position: absolute; inset: -10px; }
      .multi-pill:active { transform: translateY(3px); box-shadow: 0 1px 0 rgba(0,0,0,.18); }
      .multi-pill.live { box-shadow: 0 4px 0 rgba(0,0,0,.18), 0 0 0 3px #42e695; }
      .multi-pill.solo { opacity: .68; }
      .multi-pill.off  { opacity: .55; background: rgba(255,255,255,.78); }
      .multi-peer-fx {
        position: fixed; z-index: 35; pointer-events: none; transform: translate(-50%, -50%);
        animation: multiPeerPop .75s ease-out forwards; font-size: 30px; line-height: 1;
      }
      .multi-peer-ring {
        position: fixed; z-index: 34; pointer-events: none; border-radius: 50%; border: 4px solid var(--c, #fff);
        transform: translate(-50%, -50%); width: 24px; height: 24px;
        animation: multiRingPop .65s ease-out forwards;
      }
      @keyframes multiPeerPop {
        0%   { opacity: 0; transform: translate(-50%, -50%) scale(.4); }
        25%  { opacity: 1; transform: translate(-50%, -85%) scale(1.15); }
        100% { opacity: 0; transform: translate(-50%, -150%) scale(.95); }
      }
      @keyframes multiRingPop {
        0%   { opacity: .9; width: 22px; height: 22px; }
        100% { opacity: 0; width: 110px; height: 110px; }
      }
      .multi-ghost {
        position: fixed; z-index: 36; pointer-events: none; transform: translate(-50%, -115%); font-size: 30px; line-height: 1;
        filter: drop-shadow(0 0 4px var(--c, #fff)) drop-shadow(0 3px 0 rgba(0,0,0,.2)); transition: opacity .3s;
      }
      .multi-ghost.bye { opacity: 0; }
    `;
    document.head.appendChild(st);
  }

  function showPeer(msg, x, y) { showPeerIn(window, msg, x, y); }
  function showPeerIn(win, msg, x, y) {
    const document = win.document;
    injectStyle(document);
    const cx = Math.max(24, Math.min(win.innerWidth - 24, x));
    const cy = Math.max(54, Math.min(win.innerHeight - 24, y));
    const ring = document.createElement('div');
    ring.className = 'multi-peer-ring';
    ring.style.left = cx + 'px'; ring.style.top = cy + 'px';
    ring.style.setProperty('--c', `hsl(${msg.hu ?? 200}, 95%, 65%)`);
    document.body.appendChild(ring);
    setTimeout(() => ring.remove(), 700);

    const av = document.createElement('div');
    av.className = 'multi-peer-fx';
    av.textContent = safeAvatar(msg.av);
    av.style.left = cx + 'px'; av.style.top = cy + 'px';
    document.body.appendChild(av);
    setTimeout(() => av.remove(), 800);
  }

  // ページ側でも シェル側でも つかう「おなじ アクションを みじかい あいだに なんども おくらない」
  function throttler() {
    const last = new Map();
    return (k, gap) => {
      const now = performance.now();
      if (now - (last.get(k) || 0) < gap) return false;
      last.set(k, now);
      return true;
    };
  }

  let shell = null;
  try { if (window.parent !== window && window.parent.IroShell) shell = window.parent.IroShell; } catch (e) {}

  // ================= ページ側（iframe の中）: シェルに たのむ だけ =================
  if (shell) {
    const ok = throttler();
    let onAction = null, onState = null;
    // シェルからは JSON の もじれつで うけとり、この ページの なかで よみなおす（ページの オブジェクトとして あつかえるように）
    const port = {
      act(raw) { if (!onAction) return; let m; try { m = JSON.parse(raw); } catch (e) { return; } try { onAction(m); } catch (e) { console.error(e); } },
      state(raw) { if (!onState) return; let s = null; try { s = JSON.parse(raw); } catch (e) {} try { onState(s || {}, {}); } catch (e) { console.error(e); } },
    };
    return {
      join(key, act, st) { onAction = act; onState = st || null; shell.multi.attach(window, key, port); },
      send(data, minGapMs = 60) { if (data && ok(data.a || '_', minGapMs)) shell.multi.relay(window, data); },
      showPeer, seed, rng,
      get peers() { return shell.multi.peersHere; },
      get enabled() { return shell.multi.enabled; },
    };
  }

  // ================= シェル側（メニュー）: せつぞくを もつ =================
  // Cloudflare Workers 本番 URL（?ws=ws://localhost:8787 のみ開発用に許可）
  const PROD_WS = 'wss://iroiro-multi.teruto-to01.workers.dev';
  const LOCAL_WS_RE = /^wss?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
  const qs = new URLSearchParams(location.search);
  try {
    // まえは このタブの あいだだけ おぼえていた。ホームがめんの アプリでも つづくように きかいに おぼえる
    const old = sessionStorage.getItem('iroiro-room');
    if (old && !localStorage.getItem('iroiro-room')) localStorage.setItem('iroiro-room', old);
    sessionStorage.removeItem('iroiro-room');
    if (qs.has('room')) {
      const r = qs.get('room').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24);
      if (r) localStorage.setItem('iroiro-room', r);
      else localStorage.removeItem('iroiro-room');
    }
    if (qs.has('ws')) {
      const w = qs.get('ws').trim().replace(/\/$/, '');
      if (LOCAL_WS_RE.test(w)) sessionStorage.setItem('iroiro-ws', w);
      else sessionStorage.removeItem('iroiro-ws');
    }
  } catch (e) {}

  function wsBase() {
    try {
      const s = sessionStorage.getItem('iroiro-ws');
      if (s && LOCAL_WS_RE.test(s)) return s;
    } catch (e) {}
    return PROD_WS;
  }
  let roomCode = '';
  try { roomCode = (localStorage.getItem('iroiro-room') || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24); } catch (e) {}
  const group = !!roomCode;

  let enabled = true;
  try { if (localStorage.getItem('iroiro-multi-off') === '1') enabled = false; } catch (e) {}

  let ws = null, pill = null, myId = '', myAvatar = '🧒', myHue = 200;
  let retryMs = 1500, retryTm = 0, pingIv = 0, destroyed = false;
  let here = '';            // いま ひらいている ページ（'' は メニュー）
  let frame = null;         // { win, key, port } … いま ひらいている ページが join したら
  let pendingState = null;  // join より さきに とどいた そのページの 共有状態（JSON もじれつ）
  let dirty = false;        // つながっていない あいだに じぶんで いどうした
  let members = [];         // [{ id, av, hu, p }]
  let peersN = 1;           // ふるい サーバー むけ（同じページの 人数）
  let hooks = {};           // シェル（index.html）の よびだしさき: onGo(p, msg), onMembers(list), onMenuAct(msg)
  const ok = throttler();

  const isOpen = () => ws && ws.readyState === WebSocket.OPEN;
  const raw = (o) => { if (isOpen()) { try { ws.send(JSON.stringify(o)); } catch (e) {} } };
  // じぶんと おなじ ところに いる 人（じぶんを ふくむ）
  const peersHere = () => {
    if (!isOpen()) return 0;
    if (!group) return peersN;
    return 1 + members.filter(m => m.id !== myId && m.p === here).length;
  };
  // つながる べき か: グループ部屋なら いつでも。合言葉なしなら マルチたいおうの ページが join している あいだだけ
  const wanted = () => enabled && !destroyed && (group || !!frame);
  const roomName = () => group ? `group--${roomCode}` : `${frame.key}`;

  function renderPill() {
    if (!pill) return;
    pill.hidden = !(group || frame);
    // グループ部屋では ボタンの なかの ピルは みるだけ（あそぶ ところの はしを さわって きれない ように）。きりかえは メニューで
    pill.style.pointerEvents = group && here !== '' ? 'none' : '';
    if (!enabled) { pill.textContent = '💤'; pill.className = 'multi-pill off'; return; }
    if (!isOpen()) { pill.textContent = '🔄'; pill.className = 'multi-pill solo'; return; }
    const n = peersHere();
    if (group && n <= 4) {
      // おなじ ところに いる なかまの どうぶつを ならべる（じぶんが さいしょ）
      pill.textContent = [myAvatar, ...members.filter(m => m.id !== myId && m.p === here).map(m => safeAvatar(m.av))].join('');
    } else {
      pill.textContent = `${myAvatar} ${n}`;
    }
    pill.className = 'multi-pill ' + (n >= 2 ? 'live' : 'solo');
  }

  function ensurePill() {
    if (pill) return;
    injectStyle();
    pill = document.createElement('button');
    pill.className = 'multi-pill solo';
    pill.hidden = true;
    pill.setAttribute('aria-label', 'マルチプレイのオンオフ');
    pill.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      enabled = !enabled;
      try { localStorage.setItem('iroiro-multi-off', enabled ? '0' : '1'); } catch (err) {}
      if (enabled) { retryMs = 1500; dirty = false; sync(); Sfx.pop(); }
      else { closeSocket(); members = []; if (hooks.onMembers) hooks.onMembers([]); Sfx.tone(360, 0.1, 'sine', 0.12, 0, 220); }
      renderPill();
    });
    document.body.appendChild(pill);
  }

  function closeSocket() {
    clearTimeout(retryTm); retryTm = 0;
    clearInterval(pingIv); pingIv = 0;
    if (ws) { try { ws.onclose = ws.onerror = ws.onmessage = ws.onopen = null; ws.close(); } catch (e) {} ws = null; }
    peersN = 1;
  }

  let connectedRoom = '';
  // いまの じょうたいに あわせて つなぐ / きる / つなぎなおす
  function sync() {
    if (!wanted()) { if (ws) { closeSocket(); connectedRoom = ''; } renderPill(); return; }
    const want = roomName();
    if (ws && connectedRoom === want) { renderPill(); return; }
    connect(want);
  }

  function connect(room) {
    closeSocket();
    connectedRoom = room;
    try { ws = new WebSocket(`${wsBase()}/ws/${encodeURIComponent(room)}`); }
    catch (e) { scheduleRetry(); return; }
    renderPill();

    ws.onopen = () => {
      retryMs = 1500;
      renderPill();
      pingIv = setInterval(() => raw({ t: 'ping' }), 25000);
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'hello') {
        myId = String(msg.id || ''); myAvatar = safeAvatar(msg.avatar); myHue = msg.hue ?? 200;
        peersN = msg.n || 1;
        members = Array.isArray(msg.members) ? msg.members : [];
        if (group) {
          const place = typeof msg.place === 'string' ? msg.place : null;
          if (dirty || place === null || place === here) {
            // じぶんが うごいていた / まだ だれも きめていない / おなじ ところ → いまの ばしょを つたえる
            raw(dirty ? { t: 'go', p: here, s: hereSeed } : { t: 'at', p: here });
          } else {
            // みんなが いる ところへ いく（シェルが うごかして、あとで setHere → at が おくられる）
            raw({ t: 'at', p: here });
            if (hooks.onGo) hooks.onGo(place, { av: msg.pav, hu: msg.phu, s: msg.ps, n: msg.pn, w: msg.pw });
          }
          dirty = false;
        } else {
          raw({ t: 'at', p: here });
        }
        if (hooks.onMembers) hooks.onMembers(members.filter(m => m.id !== myId));
        renderPill();
      } else if (msg.t === 'peers') {
        if (typeof msg.n === 'number') peersN = msg.n;
        if (Array.isArray(msg.members)) {
          members = msg.members;
          if (hooks.onMembers) hooks.onMembers(members.filter(m => m.id !== myId));
        }
        renderPill();
      } else if (msg.t === 'pong') {
        if (typeof msg.n === 'number') peersN = msg.n;
        renderPill();
      } else if (msg.t === 'state') {
        if (msg.p !== here) return;
        const s = JSON.stringify(msg.s || {});
        if (frame) frame.port.state(s); else pendingState = s;
      } else if (msg.t === 'go') {
        if (group && typeof msg.p === 'string' && hooks.onGo) hooks.onGo(msg.p, msg);
      } else if (msg.t === 'start') {
        if (group && hooks.onStart) hooks.onStart(msg.n);
      } else if (msg.t === 'act') {
        if (here === '') { if (hooks.onMenuAct) hooks.onMenuAct(msg); }
        else if (msg.a === 'in') Mirror.receive(msg);
        else if (frame) frame.port.act(ev.data);
      }
    };
    ws.onclose = () => { closeSocket(); members = []; if (hooks.onMembers) hooks.onMembers([]); renderPill(); scheduleRetry(); };
    ws.onerror = () => { try { ws && ws.close(); } catch (e) {} };
  }

  function scheduleRetry() {
    if (!wanted()) return;
    clearTimeout(retryTm);
    retryTm = setTimeout(() => { connectedRoom = ''; sync(); }, retryMs);
    retryMs = Math.min(15000, Math.round(retryMs * 1.6));
  }

  // シェルが ページを かえた とき。announce = じぶんで えらんだ（みんなを つれていく）
  let hereSeed = 0;
  function setHere(p, announce, s) {
    if (p !== here) { frame = null; pendingState = null; Mirror.reset(); }
    here = p;
    hereSeed = s || 0;
    renderPill();
    if (group) {
      if (isOpen()) raw(announce ? { t: 'go', p, s: hereSeed } : { t: 'at', p });
      else if (announce && enabled) dirty = true;
    }
    sync();
  }

  // ページの Multi.join から
  function attach(win, key, port) {
    if (!win || win.parent !== window) return;
    frame = { win, key: String(key).toLowerCase().replace(/[^a-z0-9]/g, ''), port };
    if (pendingState !== null) { const s = pendingState; pendingState = null; port.state(s); }
    sync();
  }

  function send(data) {
    if (!enabled || !isOpen() || !data) return;
    const out = { t: 'act', a: data.a };
    for (const key of ['x', 'y', 'x2', 'y2', 'h']) {
      if (typeof data[key] === 'number' && Number.isFinite(data[key])) out[key] = Math.round(data[key] * 1000) / 1000;
    }
    if (typeof data.i === 'number') out.i = Math.round(data.i);
    if (typeof data.s === 'number' && Number.isFinite(data.s)) out.s = Math.abs(Math.trunc(data.s)) % 2147483647;
    if (typeof data.e === 'string') out.e = data.e;
    if (typeof data.p === 'string') out.p = data.p;
    if (data.m && typeof data.m === 'object') out.m = data.m;
    try { ws.send(JSON.stringify(out)); } catch (e) {}
  }

  // ================= みんなの ゆびを うつす（ぜんぶの ページ きょうつうの マルチ） =================
  // グループ部屋で、ボタンの ページが じぶんで Multi.join して いない とき（＝ せんようの 同期が ない ページ）は、
  // ゆびの うごき（おす・うごかす・はなす）を そのまま なかまへ おくり、なかまの がめんでは おなじ ところに
  // 「にせの ゆび」の PointerEvent を ながす。ページの つくりは かえなくて よい。
  //   ・いち: ゆびを おいた ようそ（ボタンなど）が どちらの がめんにも あれば、その ようその なかの おなじ ところ。
  //           なければ がめんの わりあい（x / はば, y / たかさ）。うごかす ときは おいた ところからの ずれ。
  //   ・ページの らんすうは シェルが そろえる（おなじ たねで Math.random を はじめる）ので、めいろ などの はいちも おなじ。
  const Mirror = (() => {
    const SYN = 9000;                    // にせの ゆびの pointerId（ほんものと かぶらない）
    const SKIP = '.back, .vol, .update-toast, .multi-pill';
    let win = null, doc = null;
    const mine = new Map();              // じぶんの pointerId → { slot, pts, tm }
    const theirs = new Map();            // 'なかまid:slot' → いまの ゆび { target, pid, sx, sy, rx, ry, ghost }
    const lanes = new Map();             // 'なかまid:slot' → { q, busy }（つぎの ゆびは まえの ゆびを ながし おわってから）
    const peerNo = new Map();
    const tagCode = (el) => { let h = 0; for (const c of el.tagName) h = (h * 31 + c.charCodeAt(0)) % 359; return h; };
    // つかえる とき: グループ部屋で つながっていて、ボタンの ページを ひらいていて、その ページに せんようの 同期が ない
    const active = () => group && enabled && isOpen() && !!win && !frame && here !== '';
    const r3 = (v) => Math.round(Math.max(0, Math.min(1, v)) * 1000) / 1000;

    function attach(w) {
      reset();
      win = w; doc = w.document;
      w.addEventListener('pointerdown', onDown, true);
      w.addEventListener('pointermove', onMove, true);
      w.addEventListener('pointerup', (e) => onEnd(e, 2), true);
      w.addEventListener('pointercancel', (e) => onEnd(e, 3), true);
    }
    function reset() {
      for (const st of mine.values()) clearTimeout(st.tm);
      for (const st of theirs.values()) if (st.ghost) st.ghost.remove();
      mine.clear(); theirs.clear(); lanes.clear();
      win = null; doc = null;
    }

    // ---- じぶんの ゆび → なかまへ ----
    function onDown(e) {
      if (!e.isTrusted || !active()) return;
      if (e.target && e.target.closest && e.target.closest(SKIP)) return;
      const used = new Set([...mine.values()].map(v => v.slot));
      let slot = 0; while (used.has(slot)) slot++;
      if (slot > 3) return;
      const W = win.innerWidth, H = win.innerHeight;
      const data = { a: 'in', i: slot * 4, x: r3(e.clientX / W), y: r3(e.clientY / H) };
      const el = e.target;
      if (el && el.nodeType === 1 && doc.body) {
        const idx = Array.prototype.indexOf.call(doc.body.getElementsByTagName('*'), el);
        const r = el.getBoundingClientRect();
        if (idx >= 0 && r.width > 0 && r.height > 0) {
          data.s = idx; data.h = tagCode(el);
          data.x2 = r3((e.clientX - r.left) / r.width); data.y2 = r3((e.clientY - r.top) / r.height);
        }
      }
      send(data);
      mine.set(e.pointerId, { slot, pts: [], tm: 0 });
    }
    function flush(st) {
      clearTimeout(st.tm); st.tm = 0;
      if (!st.pts.length) return;
      let pts = st.pts; st.pts = [];
      if (pts.length > 16) { const k = pts.length / 16; pts = Array.from({ length: 16 }, (_, i) => pts[Math.min(pts.length - 1, Math.round((i + 1) * k) - 1)]); }
      send({ a: 'in', i: st.slot * 4 + 1, m: pts });
    }
    function onMove(e) {
      const st = mine.get(e.pointerId);
      if (!st || !e.isTrusted) return;
      if (!active()) { mine.delete(e.pointerId); return; }
      st.pts.push([r3(e.clientX / win.innerWidth), r3(e.clientY / win.innerHeight)]);
      if (!st.tm) st.tm = setTimeout(() => flush(st), 66);
    }
    function onEnd(e, type) {
      const st = mine.get(e.pointerId);
      if (!st || !e.isTrusted) return;
      mine.delete(e.pointerId);
      if (!active()) return;
      flush(st);
      send({ a: 'in', i: st.slot * 4 + type, x: r3(e.clientX / win.innerWidth), y: r3(e.clientY / win.innerHeight) });
    }

    // ---- なかまの ゆび → じぶんの がめんへ ----
    function fire(st, type, x, y) {
      if (!win) return;
      const end = type === 'pointerup' || type === 'pointercancel';
      let ev;
      try {
        ev = new win.PointerEvent(type, {
          bubbles: true, cancelable: true, composed: true, view: win,
          clientX: x, clientY: y, screenX: x, screenY: y,
          pointerId: st.pid, pointerType: 'touch', isPrimary: st.slot === 0,
          button: type === 'pointermove' ? -1 : 0, buttons: end ? 0 : 1, pressure: end ? 0 : 0.5, width: 22, height: 22,
        });
      } catch (err) { return; }
      // タッチと おなじく、うごかす・はなすは おいた ようそへ（きえていたら ドキュメントへ）
      const t = st.target && st.target.isConnected ? st.target : doc;
      try { t.dispatchEvent(ev); } catch (err) { console.error(err); }
      if (st.ghost) {
        st.ghost.style.left = x + 'px'; st.ghost.style.top = y + 'px';
        if (end) { const g = st.ghost; st.ghost = null; g.classList.add('bye'); setTimeout(() => g.remove(), 320); }
      }
    }
    // うごきは すこしずつ ながす（いっぺんに ながすと はやさが 0 に なる ページが ある）
    function push(key, st, type, x, y) {
      let ln = lanes.get(key);
      if (!ln) { ln = { q: [], busy: false }; lanes.set(key, ln); }
      ln.q.push([st, type, x, y]);
      if (ln.busy) return;
      const step = () => {
        if (lanes.get(key) !== ln) return; // ページが かわった
        const it = ln.q.shift();
        if (!it) { ln.busy = false; return; }
        fire(it[0], it[1], it[2], it[3]);
        setTimeout(step, it[1] === 'pointermove' ? 16 : 0);
      };
      ln.busy = true; step();
    }
    function receive(msg) {
      if (!win || frame || !doc || !doc.body) return;
      if (typeof msg.i !== 'number') return;
      const type = msg.i & 3, slot = msg.i >> 2, key = msg.from + ':' + slot;
      const W = win.innerWidth, H = win.innerHeight;
      if (type === 0) {
        const old = theirs.get(key);
        if (old) { theirs.delete(key); push(key, old, 'pointercancel', old.rx, old.ry); }
        let cx = (msg.x ?? 0.5) * W, cy = (msg.y ?? 0.5) * H, target = null;
        if (typeof msg.s === 'number') {
          const el = doc.body.getElementsByTagName('*')[msg.s];
          if (el && tagCode(el) === msg.h) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              const px = r.left + (msg.x2 ?? 0.5) * r.width, py = r.top + (msg.y2 ?? 0.5) * r.height;
              const hit = doc.elementFromPoint(px, py);
              if (hit && (hit === el || el.contains(hit))) { cx = px; cy = py; target = hit; }
            }
          }
        }
        if (!target) target = doc.elementFromPoint(cx, cy);
        if (!target || (target.closest && target.closest(SKIP))) return;
        if (!peerNo.has(msg.from)) peerNo.set(msg.from, peerNo.size % 200);
        const st = { target, slot, pid: SYN + peerNo.get(msg.from) * 4 + slot, sx: msg.x ?? 0.5, sy: msg.y ?? 0.5, rx: cx, ry: cy, ghost: null };
        theirs.set(key, st);
        showPeerIn(win, msg, cx, cy);
        const g = doc.createElement('div');
        g.className = 'multi-ghost'; g.textContent = safeAvatar(msg.av);
        g.style.setProperty('--c', `hsl(${msg.hu ?? 200}, 95%, 65%)`);
        doc.body.appendChild(g); st.ghost = g;
        g.style.left = cx + 'px'; g.style.top = cy + 'px';
        push(key, st, 'pointerdown', cx, cy);
        return;
      }
      const st = theirs.get(key);
      if (!st) return;
      const at = (x, y) => [st.rx + ((x ?? st.sx) - st.sx) * W, st.ry + ((y ?? st.sy) - st.sy) * H];
      if (type === 1) {
        if (!Array.isArray(msg.m)) return;
        for (const p of msg.m) if (Array.isArray(p)) push(key, st, 'pointermove', ...at(p[0], p[1]));
      } else {
        theirs.delete(key);
        push(key, st, type === 2 ? 'pointerup' : 'pointercancel', ...at(msg.x, msg.y));
      }
    }
    return { attach, reset, receive };
  })();

  window.addEventListener('pagehide', (e) => { if (!e.persisted) { destroyed = true; closeSocket(); } });
  window.addEventListener('pageshow', (e) => { if (e.persisted) { destroyed = false; connectedRoom = ''; sync(); } });

  function init(h) {
    hooks = h || {};
    if (document.body) ensurePill(); else window.addEventListener('DOMContentLoaded', ensurePill);
    sync();
  }

  return {
    // シェル（index.html）むけ
    init, setHere, attach,
    mirror(win) { if (win && win.parent === window) Mirror.attach(win); }, // ボタンの ページの common.js から
    relay(win, data) { if (frame && frame.win === win) send(data); }, // ページから（まびきは ページ側で すんでいる）
    send(data, minGapMs = 60) { if (data && ok(data.a || '_', minGapMs)) send(data); },
    get group() { return group; },
    get connected() { return isOpen(); },
    get myId() { return myId; },
    get myAvatar() { return myAvatar; },
    get myHue() { return myHue; },
    // いどうさきの じゅんびが できた（グループ部屋で みんなで そろって ひらく ため）
    ready(n) { if (group && Number.isInteger(n)) raw({ t: 'ready', n }); },
    get enabled() { return enabled; },
    get peersHere() { return peersHere(); },
    // ページ むけと おなじ もの
    join() {}, showPeer, seed, rng,
    get peers() { return peersHere(); },
  };
})();
