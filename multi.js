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

  function injectStyle() {
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
    `;
    document.head.appendChild(st);
  }

  function showPeer(msg, x, y) {
    injectStyle();
    const cx = Math.max(24, Math.min(innerWidth - 24, x));
    const cy = Math.max(54, Math.min(innerHeight - 24, y));
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
            raw({ t: dirty ? 'go' : 'at', p: here });
          } else {
            // みんなが いる ところへ いく（シェルが うごかして、あとで setHere → at が おくられる）
            raw({ t: 'at', p: here });
            if (hooks.onGo) hooks.onGo(place, { av: msg.pav, hu: msg.phu });
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
      } else if (msg.t === 'act') {
        if (here === '') { if (hooks.onMenuAct) hooks.onMenuAct(msg); }
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
  function setHere(p, announce) {
    if (p !== here) { frame = null; pendingState = null; }
    here = p;
    renderPill();
    if (group) {
      if (isOpen()) raw({ t: announce ? 'go' : 'at', p });
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
    relay(win, data) { if (frame && frame.win === win) send(data); }, // ページから（まびきは ページ側で すんでいる）
    send(data, minGapMs = 60) { if (data && ok(data.a || '_', minGapMs)) send(data); },
    get group() { return group; },
    get connected() { return isOpen(); },
    get myId() { return myId; },
    get enabled() { return enabled; },
    get peersHere() { return peersHere(); },
    // ページ むけと おなじ もの
    join() {}, showPeer, seed, rng,
    get peers() { return peersHere(); },
  };
})();
