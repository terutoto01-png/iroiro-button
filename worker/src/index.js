import { DurableObject } from 'cloudflare:workers';

// いろいろボタン マルチプレイ中継サーバー（Cloudflare Workers + Durable Objects Free Tier対応）
// ・WebSocket Hibernation API を使用（待機中の課金・コンピュート消費ゼロ）
// ・自由文字列は一切通さず、定義済みのアクションID・数値・許可された絵文字のみ中継（子ども向けに安全）

const AVATARS = ['🐶', '🐱', '🐰', '🐻', '🐼', '🐸', '🦊', '🐧', '🐷', '🐥', '🦁', '🐨'];
const ALLOWED_EMOJIS = new Set([
  '🐶', '🐱', '🐰', '🐻', '🐼', '🐸', '🐷', '🐥', '🍎', '🍓', '🍌', '🍉', '🍩', '🍰',
  '🚗', '🚃', '🚀', '✈️', '🐟', '🐙', '🐳', '⭐', '🌙', '🌈', '❤️', '🌸', '🌻', '🦋', '🦖', '🎈',
]);
const ALLOWED_ACTIONS = new Set(['fire', 'finale', 'blow', 'pop', 'bell', 'night', 'stamp', 'drop', 'bar', 'bump', 'wheel', 'fever']);
const MAX_PEERS = 20;
const MAX_MSG_BYTES = 320;
const MAX_PER_SEC = 18;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

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
      return new Response('Expected WebSocket', { status: 426, headers: CORS });
    }
    const existing = this.ctx.getWebSockets();
    if (existing.length >= MAX_PEERS) {
      return new Response('Room full', { status: 503, headers: CORS });
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

    const n = this.ctx.getWebSockets().length;
    try { server.send(JSON.stringify({ t: 'hello', id, avatar, hue, n })); } catch {}
    this.broadcastPeers(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, raw) {
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
    const h = clampNum(msg.h, 0, 360); if (h !== undefined) out.h = h;
    if (typeof msg.e === 'string' && ALLOWED_EMOJIS.has(msg.e)) out.e = msg.e;

    const encoded = JSON.stringify(out);
    for (const peer of this.ctx.getWebSockets()) {
      if (peer === ws) continue;
      try { peer.send(encoded); } catch {}
    }
  }

  webSocketClose(ws) {
    try { ws.close(); } catch {}
    this.broadcastPeers(ws);
  }

  webSocketError(ws) {
    try { ws.close(); } catch {}
    this.broadcastPeers(ws);
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
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    if (url.pathname === '/health' || url.pathname === '/') {
      return new Response(JSON.stringify({ ok: true, service: 'iroiro-multi' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    const m = url.pathname.match(/^\/ws\/([a-zA-Z0-9_-]{1,48})$/);
    if (!m) return new Response('Not found', { status: 404, headers: CORS });
    const roomName = m[1].toLowerCase();
    const id = env.ROOM.idFromName(roomName);
    return env.ROOM.get(id).fetch(request);
  },
};
