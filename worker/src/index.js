import { DurableObject } from 'cloudflare:workers';

// いろいろボタン マルチプレイ中継サーバー（Cloudflare Workers + Durable Objects Free Tier対応）
// ・WebSocket Hibernation API を使用（待機中の課金・コンピュート消費ゼロ）
// ・自由文字列は一切通さず、定義済みのアクションID・数値・許可された絵文字のみ中継（子ども向けに安全）

const AVATARS = ['🐶', '🐱', '🐰', '🐻', '🐼', '🐸', '🦊', '🐧', '🐷', '🐥', '🦁', '🐨'];
const ALLOWED_EMOJIS = new Set([
  '🐶', '🐱', '🐰', '🐻', '🐼', '🐸', '🐷', '🐥', '🍎', '🍓', '🍌', '🍉', '🍩', '🍰',
  '🚗', '🚃', '🚀', '✈️', '🐟', '🐙', '🐳', '⭐', '🌙', '🌈', '❤️', '🌸', '🌻', '🦋', '🦖', '🎈',
]);
const ALLOWED_PAGES = new Set(['hanabi', 'shabondama', 'beru', 'sutanpu', 'korokoro']);
const ALLOWED_ACTIONS = new Set(['fire', 'finale', 'blow', 'pop', 'bell', 'night', 'stamp', 'drop', 'bar', 'bump', 'wheel', 'fever', 'world', 'layout']);
const MAX_PEERS = 20;
const MAX_MSG_BYTES = 2400;
const MAX_PER_SEC = 18;

function sanitizeLayout(m) {
  if (!m || typeof m !== 'object') return undefined;
  const pts = (arr, dims, maxLen) => {
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (let i = 0; i < Math.min(arr.length, maxLen); i++) {
      const p = arr[i];
      if (!Array.isArray(p) || p.length !== dims) continue;
      const clean = [];
      let ok = true;
      for (let j = 0; j < dims; j++) {
        const v = clampNum(p[j], 0, 1);
        if (v === undefined) { ok = false; break; }
        clean.push(v);
      }
      if (ok) out.push(clean);
    }
    return out;
  };
  let star = null;
  if (Array.isArray(m.s) && m.s.length === 2) {
    const sx = clampNum(m.s[0], 0, 1), sy = clampNum(m.s[1], 0, 1);
    if (sx !== undefined && sy !== undefined) star = [sx, sy];
  }
  return {
    l: pts(m.l, 4, 24), b: pts(m.b, 2, 16), w: pts(m.w, 2, 10),
    t: pts(m.t, 2, 10), c: pts(m.c, 2, 10), p: pts(m.p, 4, 8), s: star,
  };
}

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (origin === 'https://terutoto01-png.github.io') return true;
  return /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+)(:\d+)?$/.test(origin);
}

function corsHeaders(origin) {
  const h = { 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (isAllowedOrigin(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function clampNum(v, min, max) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return Math.round(Math.max(min, Math.min(max, v)) * 1000) / 1000;
}

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.rates = new Map();
  }

  async fetch(request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }
    const existing = this.ctx.getWebSockets();
    if (existing.length >= MAX_PEERS) {
      return new Response('Room full', { status: 503 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // いま部屋にいない動物を優先して割り当てる
    const used = new Set();
    for (const ws of existing) {
      try { const a = ws.deserializeAttachment(); if (a?.avatar) used.add(a.avatar); } catch {}
    }
    const free = AVATARS.filter(a => !used.has(a));
    const pool = free.length ? free : AVATARS;
    const avatar = pool[Math.floor(Math.random() * pool.length)];
    const id = Math.random().toString(36).slice(2, 8);
    const hue = Math.floor(Math.random() * 360);

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id, avatar, hue });

    // すでに部屋に誰かいるなら最新の共有状態（世界・配置など）を新規参加者へ即座に渡す
    let state = null;
    if (existing.length > 0) {
      try { state = (await this.ctx.storage.get('state')) || null; } catch {}
    } else {
      try { await this.ctx.storage.delete('state'); } catch {}
    }

    const n = this.ctx.getWebSockets().length;
    try { server.send(JSON.stringify(state ? { t: 'hello', id, avatar, hue, n, state } : { t: 'hello', id, avatar, hue, n })); } catch {}
    this.broadcastPeers(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > MAX_MSG_BYTES) return;
    let att;
    try { att = ws.deserializeAttachment(); } catch {}
    if (!att) return;

    // 連打・フラッド対策（1秒あたりの上限）
    const now = Date.now();
    let r = this.rates.get(att.id);
    if (!r || now - r.t >= 1000) { r = { t: now, c: 0 }; this.rates.set(att.id, r); }
    if (++r.c > MAX_PER_SEC) return;

    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === 'ping') {
      try { ws.send(JSON.stringify({ t: 'pong', n: this.ctx.getWebSockets().length })); } catch {}
      return;
    }
    if (msg.t !== 'act' || !ALLOWED_ACTIONS.has(msg.a)) return;

    // 許可されたフィールドのみサニタイズして中継
    const out = { t: 'act', from: att.id, av: att.avatar, hu: att.hue, a: msg.a };
    const x = clampNum(msg.x, 0, 1); if (x !== undefined) out.x = x;
    const y = clampNum(msg.y, 0, 1); if (y !== undefined) out.y = y;
    const x2 = clampNum(msg.x2, 0, 1); if (x2 !== undefined) out.x2 = x2;
    const y2 = clampNum(msg.y2, 0, 1); if (y2 !== undefined) out.y2 = y2;
    if (typeof msg.i === 'number' && Number.isInteger(msg.i) && msg.i >= -10 && msg.i <= 100) out.i = msg.i;
    if (typeof msg.s === 'number' && Number.isInteger(msg.s) && msg.s >= 0 && msg.s <= 2147483647) out.s = msg.s;
    const h = clampNum(msg.h, 0, 360); if (h !== undefined) out.h = h;
    if (typeof msg.e === 'string' && ALLOWED_EMOJIS.has(msg.e)) out.e = msg.e;
    if (msg.a === 'layout') {
      const m = sanitizeLayout(msg.m);
      if (!m) return;
      out.m = m;
    }

    // あとから来た人にも同じ世界・配置を合わせるため共有状態を記憶
    if (msg.a === 'world' || msg.a === 'layout' || msg.a === 'night') {
      try {
        const st = (await this.ctx.storage.get('state')) || {};
        if (msg.a === 'world' && out.i !== undefined) { st.world = out.i; if (out.i !== 3) delete st.layout; }
        else if (msg.a === 'layout') { st.world = 3; st.layout = out.m; }
        else if (msg.a === 'night' && out.i !== undefined) { st.night = out.i ? 1 : 0; }
        await this.ctx.storage.put('state', st);
      } catch {}
    }

    const encoded = JSON.stringify(out);
    for (const peer of this.ctx.getWebSockets()) {
      if (peer === ws) continue;
      try { peer.send(encoded); } catch {}
    }
  }

  webSocketClose(ws) {
    try { ws.close(); } catch {}
    this.broadcastPeers(ws);
    if (this.ctx.getWebSockets().filter(s => s !== ws).length === 0) {
      this.ctx.storage.delete('state').catch(() => {});
    }
  }

  webSocketError(ws) {
    try { ws.close(); } catch {}
    this.broadcastPeers(ws);
    if (this.ctx.getWebSockets().filter(s => s !== ws).length === 0) {
      this.ctx.storage.delete('state').catch(() => {});
    }
  }

  broadcastPeers(exclude) {
    const sockets = this.ctx.getWebSockets().filter(s => s !== exclude);
    const n = sockets.length + (exclude && exclude.readyState === 1 ? 1 : 0);
    const payload = JSON.stringify({ t: 'peers', n });
    for (const s of sockets) {
      try { s.send(payload); } catch {}
    }
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(request.url);
    if (url.pathname === '/health' || url.pathname === '/') {
      return new Response(JSON.stringify({ ok: true, service: 'iroiro-multi' }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
    const m = url.pathname.match(/^\/ws\/([a-zA-Z0-9]+)(?:--([a-zA-Z0-9_-]{1,24}))?$/);
    if (!m || !ALLOWED_PAGES.has(m[1].toLowerCase())) {
      return new Response('Not found', { status: 404, headers: cors });
    }
    if (!isAllowedOrigin(origin)) {
      return new Response('Forbidden', { status: 403 });
    }
    const roomName = (m[2] ? `${m[1]}--${m[2]}` : m[1]).toLowerCase();
    const id = env.ROOM.idFromName(roomName);
    return env.ROOM.get(id).fetch(request);
  },
};
