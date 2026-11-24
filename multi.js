// いろいろボタン 共通マルチプレイ（WebSocket / Cloudflare Workers + Durable Objects 対応）
// つかいかた:
//   Multi.join('hanabi', (msg) => { ... });
//   Multi.send({ a: 'fire', x: 0.5, y: 0.3 });
//   Multi.showPeer(msg, x, y); // 相手の動物アイコンと波紋をふわっと表示
//
// ・Cloudflare Workers にデプロイ後、下の PROD_WS に wss://〜 を入れると本番（GitHub Pages）でも自動接続。
// ・localhost / LAN IP（192.168.x.x など）では自動で ws://<host>:8787（wrangler dev）に接続。
// ・?room=kazuki のようにURLに付けると家族専用ルームで遊べる（メニュー移動後も記憶）。
// ・オフラインやサーバー未設定時はそのまま1人プレイとして動く。

const Multi = (() => {
  // Cloudflare Workers 本番 URL（?ws=ws://localhost:8787 のみ開発用に許可）
  const PROD_WS = 'wss://iroiro-multi.teruto-to01.workers.dev';
  const SAFE_AVATARS = new Set(['🐶', '🐱', '🐰', '🐻', '🐼', '🐸', '🦊', '🐧', '🐷', '🐥', '🦁', '🐨', '🧒']);
  const safeAvatar = (v) => (typeof v === 'string' && SAFE_AVATARS.has(v)) ? v : '🧒';

  const qs = new URLSearchParams(location.search);
  try {
    if (qs.has('room')) {
      const r = qs.get('room').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24);
      if (r) sessionStorage.setItem('iroiro-room', r);
      else sessionStorage.removeItem('iroiro-room');
    }
    if (qs.has('ws')) {
      const w = qs.get('ws').trim().replace(/\/$/, '');
      if (/^wss?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(w)) sessionStorage.setItem('iroiro-ws', w);
      else sessionStorage.removeItem('iroiro-ws');
    }
  } catch (e) {}

  function wsBase() {
    try {
      const s = sessionStorage.getItem('iroiro-ws');
      if (s && /^wss?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(s)) return s;
    } catch (e) {}
    return PROD_WS;
  }

  function roomSuffix() {
    try { return sessionStorage.getItem('iroiro-room') || ''; } catch (e) { return ''; }
  }

  let enabled = true;
  try { if (localStorage.getItem('iroiro-multi-off') === '1') enabled = false; } catch (e) {}

  let ws = null, pageKey = '', handler = null, pill = null, myAvatar = '🧒', myHue = 200, peers = 0;
  let retryMs = 1500, retryTm = 0, pingIv = 0, destroyed = false;
  const lastSent = new Map();

  function injectStyle() {
    if (document.getElementById('multi-style')) return;
    const st = document.createElement('style');
    st.id = 'multi-style';
    st.textContent = `
      .multi-pill {
        position: fixed; top: max(12px, env(safe-area-inset-top)); left: 50%; transform: translateX(-50%);
        z-index: 48; border: none; border-radius: 999px; background: rgba(255,255,255,.92); color: #333;
        font-family: inherit; font-size: 18px; font-weight: bold; padding: 6px 14px;
        box-shadow: 0 4px 0 rgba(0,0,0,.18); cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
        transition: opacity .25s, transform .08s, box-shadow .25s;
      }
      .multi-pill::after { content: ''; position: absolute; inset: -12px; }
      .multi-pill:active { transform: translateX(-50%) translateY(3px); box-shadow: 0 1px 0 rgba(0,0,0,.18); }
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

  function renderPill() {
    if (!pill) return;
    if (!enabled) {
      pill.textContent = '💤';
      pill.className = 'multi-pill off';
      return;
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      pill.textContent = `${myAvatar} ${peers}`;
      pill.className = 'multi-pill ' + (peers >= 2 ? 'live' : 'solo');
    } else {
      pill.textContent = '🔄';
      pill.className = 'multi-pill solo';
    }
  }

  function ensurePill() {
    if (pill || !wsBase()) return;
    injectStyle();
    pill = document.createElement('button');
    pill.className = 'multi-pill solo';
    pill.setAttribute('aria-label', 'マルチプレイのオンオフ');
    pill.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      enabled = !enabled;
      try { localStorage.setItem('iroiro-multi-off', enabled ? '0' : '1'); } catch (err) {}
      if (enabled) { retryMs = 1500; connect(); Sfx.pop(); }
      else { closeSocket(); Sfx.tone(360, 0.1, 'sine', 0.12, 0, 220); }
      renderPill();
    });
    if (document.body) document.body.appendChild(pill);
    else window.addEventListener('DOMContentLoaded', () => document.body.appendChild(pill));
    renderPill();
  }

  function closeSocket() {
    clearTimeout(retryTm); retryTm = 0;
    clearInterval(pingIv); pingIv = 0;
    if (ws) { try { ws.onclose = ws.onerror = ws.onmessage = null; ws.close(); } catch (e) {} ws = null; }
    peers = 0;
  }

  function connect() {
    if (destroyed || !enabled || !pageKey) return;
    const base = wsBase();
    if (!base) return;
    closeSocket();
    const suf = roomSuffix();
    const room = suf ? `${pageKey}--${suf}` : pageKey;
    try { ws = new WebSocket(`${base}/ws/${encodeURIComponent(room)}`); }
    catch (e) { scheduleRetry(); return; }

    ws.onopen = () => {
      retryMs = 1500;
      renderPill();
      pingIv = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          try { ws.send('{"t":"ping"}'); } catch (e) {}
        }
      }, 25000);
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'hello') {
        myAvatar = safeAvatar(msg.avatar); myHue = msg.hue ?? 200; peers = msg.n || 1;
        renderPill();
      } else if (msg.t === 'peers' || msg.t === 'pong') {
        if (typeof msg.n === 'number') { peers = msg.n; renderPill(); }
      } else if (msg.t === 'act' && handler) {
        handler(msg);
      }
    };
    ws.onclose = () => { closeSocket(); renderPill(); scheduleRetry(); };
    ws.onerror = () => { try { ws && ws.close(); } catch (e) {} };
  }

  function scheduleRetry() {
    if (destroyed || !enabled || !wsBase()) return;
    clearTimeout(retryTm);
    retryTm = setTimeout(connect, retryMs);
    retryMs = Math.min(15000, Math.round(retryMs * 1.6));
  }

  function join(key, onAction) {
    pageKey = key;
    handler = onAction;
    if (!wsBase()) return;
    ensurePill();
    if (enabled) connect();
  }

  function send(data, minGapMs = 60) {
    if (!enabled || !ws || ws.readyState !== WebSocket.OPEN) return;
    const k = data.a || '_';
    const now = performance.now();
    if (now - (lastSent.get(k) || 0) < minGapMs) return;
    lastSent.set(k, now);
    const out = { t: 'act', a: data.a };
    for (const key of ['x', 'y', 'x2', 'y2', 'h']) {
      if (typeof data[key] === 'number' && Number.isFinite(data[key])) out[key] = Math.round(data[key] * 1000) / 1000;
    }
    if (typeof data.i === 'number') out.i = Math.round(data.i);
    if (typeof data.s === 'number' && Number.isFinite(data.s)) out.s = Math.abs(Math.trunc(data.s)) % 2147483647;
    if (typeof data.e === 'string') out.e = data.e;
    try { ws.send(JSON.stringify(out)); } catch (e) {}
  }

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

  function showPeer(msg, x, y) {
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

  window.addEventListener('pagehide', () => { destroyed = true; closeSocket(); });

  return { join, send, showPeer, seed, rng, get peers() { return peers; }, get enabled() { return enabled; } };
})();
