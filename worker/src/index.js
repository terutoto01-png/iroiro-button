import { DurableObject } from 'cloudflare:workers';

// いろいろボタン マルチプレイ中継サーバー（Cloudflare Workers + Durable Objects Free Tier対応）
// ・WebSocket Hibernation API を使用（待機中の課金・コンピュート消費ゼロ）
// ・自由文字列は一切通さず、定義済みのアクションID・数値・許可された絵文字・ページ名（英小文字）のみ中継（子ども向けに安全）
//
// 部屋は2種類:
//   ・ページ部屋  /ws/hanabi, /ws/hanabi--kazuki … そのページで遊ぶ人だけの部屋（合言葉なしのとき）
//   ・グループ部屋 /ws/group--kazuki … 家族の合言葉の部屋。メニューも全ボタンもこの1本でつながる。
//     ひとりがボタンに入る（go）と、みんな同じボタンへ移動する。ボタンの中の同期は同じページにいる人どうしだけに中継。

const AVATARS = ['🐶', '🐱', '🐰', '🐻', '🐼', '🐸', '🦊', '🐧', '🐷', '🐥', '🦁', '🐨'];
const ALLOWED_EMOJIS = new Set([
  '🐶', '🐱', '🐰', '🐻', '🐼', '🐸', '🐷', '🐥', '🍎', '🍓', '🍌', '🍉', '🍩', '🍰',
  '🚗', '🚃', '🚀', '✈️', '🐟', '🐙', '🐳', '⭐', '🌙', '🌈', '❤️', '🌸', '🌻', '🦋', '🦖', '🎈',
]);
const ALLOWED_PAGES = new Set(['hanabi', 'shabondama', 'beru', 'sutanpu', 'korokoro', 'karakuri']);
const ALLOWED_ACTIONS = new Set(['fire', 'finale', 'blow', 'pop', 'bell', 'night', 'stamp', 'drop', 'bar', 'bump', 'wheel', 'fever', 'world', 'layout', 'klayout', 'ktap', 'look', 'sec', 'in']);
const STATE_ACTIONS = new Set(['world', 'layout', 'klayout', 'night']);
const PAGE_RE = /^[a-z]{1,20}$/; // ページ名（ファイル名）。'' はメニュー
const MAX_PEERS = 20;
const MAX_MSG_BYTES = 4500;
const MAX_PER_SEC = 45; // ゆびの うごき（in）を おくるので おおめ
const GO_LOCK_MS = 2000; // だれかが移動させたあと、しばらくは別の場所への移動を受け付けない（同時タップ・連打対策）

const cleanPage = (v) => (v === '' || (typeof v === 'string' && PAGE_RE.test(v))) ? v : undefined;

function sanitizeKLayout(m) {
  if (!m || typeof m !== 'object') return undefined;
  const rows = (arr, spec, maxLen) => {
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (let i = 0; i < Math.min(arr.length, maxLen); i++) {
      const p = arr[i];
      if (!Array.isArray(p) || p.length !== spec.length) continue;
      const clean = [];
      let ok = true;
      for (let j = 0; j < spec.length; j++) {
        const [mn, mx] = spec[j];
        const v = clampNum(p[j], mn, mx);
        if (v === undefined) { ok = false; break; }
        clean.push(v);
      }
      if (ok) out.push(clean);
    }
    return out;
  };
  let st = null;
  if (Array.isArray(m.st) && m.st.length === 2) {
    const sx = clampNum(m.st[0], 0, 1), sy = clampNum(m.st[1], -0.1, 1.6);
    if (sx !== undefined && sy !== undefined) st = [sx, sy];
  }
  return {
    r: rows(m.r, [[0, 1], [-0.1, 1.6], [0, 1], [-0.1, 1.6]], 40),
    d: rows(m.d, [[0, 1], [-0.1, 1.6], [-1, 1]], 8),
    s: rows(m.s, [[0, 1], [-0.1, 1.6], [-1, 1]], 8),
    b: rows(m.b, [[0, 1], [-0.1, 1.6]], 8),
    l: rows(m.l, [[0, 1], [-0.1, 1.6], [0.05, 1.6], [-1, 1]], 4),
    p: rows(m.p, [[0, 1], [-0.1, 1.6], [-1, 1]], 8),
    st,
  };
}

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

  att(ws) { try { return ws.deserializeAttachment() || null; } catch { return null; } }
  live(exclude) { return this.ctx.getWebSockets().filter(s => s !== exclude && s.readyState !== 2 && s.readyState !== 3); }
  // p にいる人（exclude をのぞく）
  inPage(p, exclude) { return this.live(exclude).filter(s => { const a = this.att(s); return a && a.p === p; }); }

  async fetch(request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }
    const roomName = new URL(request.url).searchParams.get('room') || '';
    const group = roomName.startsWith('group--');
    const pageRoom = group ? null : roomName.split('--')[0];

    const existing = this.live();
    if (existing.length >= MAX_PEERS) {
      return new Response('Room full', { status: 503 });
    }
    if (existing.length === 0) {
      try { await this.ctx.storage.deleteAll(); } catch {}
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // いま部屋にいない動物を優先して割り当てる
    const used = new Set();
    for (const ws of existing) { const a = this.att(ws); if (a?.avatar) used.add(a.avatar); }
    const free = AVATARS.filter(a => !used.has(a));
    const pool = free.length ? free : AVATARS;
    const avatar = pool[Math.floor(Math.random() * pool.length)];
    const id = Math.random().toString(36).slice(2, 8);
    const hue = Math.floor(Math.random() * 360);
    // グループ部屋では、どこにいるか（at）が届くまで どのページにもいない（null）
    const me = { id, avatar, hue, g: group, p: group ? null : pageRoom };

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(me);

    const hello = { t: 'hello', id, avatar, hue, g: group ? 1 : 0, n: (group ? 0 : this.inPage(pageRoom, server).length) + 1, members: this.memberList(server) };
    if (group) {
      try { const pl = await this.ctx.storage.get('place'); if (pl) { hello.place = pl.p; hello.ps = pl.s || 0; hello.pav = pl.av; hello.phu = pl.hu; } } catch {}
    } else if (existing.length > 0) {
      // ふるい クライアント（hello の state を待つ）向けに、同じページの共有状態も添える
      try { const st = await this.ctx.storage.get('state:' + pageRoom); if (st) hello.state = st; } catch {}
    }
    try { server.send(JSON.stringify(hello)); } catch {}
    this.broadcastPeers(null, server); // あたらしい人も かぞえる（hello を うけとったので おくらない）

    return new Response(null, { status: 101, webSocket: client });
  }

  memberList(exclude) {
    const out = [];
    for (const s of this.live(exclude)) {
      const a = this.att(s);
      if (a) out.push({ id: a.id, av: a.avatar, hu: a.hue, p: a.p });
    }
    return out;
  }

  // ws の いる ページを p に変える。前のページに誰もいなくなったら、そのページの共有状態は消す（今までと同じ「ひとりで入りなおすと まっさら」）。
  // 返り値: 新しいページの共有状態（ほかに人がいれば）
  async moveTo(ws, att, p) {
    const prev = att.p;
    att.p = p;
    ws.serializeAttachment(att);
    if (prev !== null && prev !== p && this.inPage(prev, ws).length === 0) {
      try { await this.ctx.storage.delete('state:' + prev); } catch {}
    }
    if (this.inPage(p, ws).length === 0) {
      try { await this.ctx.storage.delete('state:' + p); } catch {}
      return null;
    }
    try { return (await this.ctx.storage.get('state:' + p)) || null; } catch { return null; }
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > MAX_MSG_BYTES) return;
    const att = this.att(ws);
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
      try { ws.send(JSON.stringify({ t: 'pong', n: att.p === null ? 1 : this.inPage(att.p, ws).length + 1 })); } catch {}
      return;
    }

    // いま どこに いるか（グループ部屋のみ ページを変えられる。ページ部屋は そのページ固定）
    if (msg.t === 'at' || msg.t === 'go') {
      const p = att.g ? cleanPage(msg.p) : att.p;
      if (p === undefined) return;
      if (msg.t === 'go' && att.g) {
        const s = Number.isInteger(msg.s) && msg.s > 0 && msg.s < 2147483647 ? msg.s : 0;
        let place = null;
        try { place = (await this.ctx.storage.get('place')) || null; } catch {}
        if (place && place.p !== p && now - place.t < GO_LOCK_MS) {
          // ほかの人が さっき 移動させたばかり → その場所へ もどってもらう
          try { ws.send(JSON.stringify({ t: 'go', p: place.p, s: place.s || 0, av: place.av, hu: place.hu, from: place.id })); } catch {}
          return;
        }
        try { await this.ctx.storage.put('place', { p, s, t: now, id: att.id, av: att.avatar, hu: att.hue }); } catch {}
        const out = JSON.stringify({ t: 'go', p, s, av: att.avatar, hu: att.hue, from: att.id });
        for (const peer of this.live(ws)) { try { peer.send(out); } catch {} }
      } else if (att.g) {
        // グループの場所がまだ決まっていなければ、さいしょに来た人の場所にする
        try {
          if (!(await this.ctx.storage.get('place'))) await this.ctx.storage.put('place', { p, t: 0, id: att.id, av: att.avatar, hu: att.hue });
        } catch {}
      }
      const st = await this.moveTo(ws, att, p);
      try { ws.send(JSON.stringify({ t: 'state', p, s: st })); } catch {}
      this.broadcastPeers(null);
      return;
    }

    if (msg.t !== 'act' || !ALLOWED_ACTIONS.has(msg.a) || att.p === null) return;

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
    const pg = cleanPage(msg.p); if (pg) out.p = pg;
    if (msg.a === 'layout') {
      const m = sanitizeLayout(msg.m);
      if (!m) return;
      out.m = m;
    } else if (msg.a === 'klayout') {
      const m = sanitizeKLayout(msg.m);
      if (!m) return;
      out.m = m;
    } else if (msg.a === 'in' && Array.isArray(msg.m)) {
      // ゆびの うごき: [x, y]（0〜1）を 16こ まで
      const pts = [];
      for (const p of msg.m.slice(0, 16)) {
        if (!Array.isArray(p) || p.length !== 2) continue;
        const px = clampNum(p[0], 0, 1), py = clampNum(p[1], 0, 1);
        if (px !== undefined && py !== undefined) pts.push([px, py]);
      }
      out.m = pts;
    }

    // あとから来た人にも同じ世界・配置を合わせるため、ページごとに共有状態を記憶
    if (STATE_ACTIONS.has(msg.a)) {
      try {
        const key = 'state:' + att.p;
        const st = (await this.ctx.storage.get(key)) || {};
        if (msg.a === 'world' && out.i !== undefined) { st.world = out.i; if (out.i !== 3) delete st.layout; }
        else if (msg.a === 'layout') { st.world = 3; st.layout = out.m; }
        else if (msg.a === 'klayout') { st.klayout = out.m; }
        else if (msg.a === 'night' && out.i !== undefined) { st.night = out.i ? 1 : 0; }
        await this.ctx.storage.put(key, st);
      } catch {}
    }

    const encoded = JSON.stringify(out);
    for (const peer of this.inPage(att.p, ws)) {
      try { peer.send(encoded); } catch {}
    }
  }

  async gone(ws) {
    const att = this.att(ws);
    try { ws.close(); } catch {}
    const rest = this.live(ws);
    if (rest.length === 0) {
      try { await this.ctx.storage.deleteAll(); } catch {}
      return;
    }
    if (att && att.p !== null && this.inPage(att.p, ws).length === 0) {
      try { await this.ctx.storage.delete('state:' + att.p); } catch {}
    }
    this.broadcastPeers(ws, ws);
  }

  async webSocketClose(ws) { await this.gone(ws); }
  async webSocketError(ws) { await this.gone(ws); }

  // だれが どこに いるか を みんなへ。n は「じぶんと 同じページにいる人数（じぶんをふくむ）」（ふるいクライアント用）
  // gone = もう いない人（かぞえない）、skip = かぞえるが おくらない人
  broadcastPeers(gone, skip) {
    const sockets = this.live(gone);
    const members = this.memberList(gone);
    for (const s of sockets) {
      if (s === skip) continue;
      const a = this.att(s);
      const n = a && a.p !== null ? members.filter(m => m.p === a.p).length : 1;
      try { s.send(JSON.stringify({ t: 'peers', n, members })); } catch {}
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
    const kind = m ? m[1].toLowerCase() : '';
    // グループ部屋は合言葉つきのときだけ
    if (!m || !(ALLOWED_PAGES.has(kind) || (kind === 'group' && m[2]))) {
      return new Response('Not found', { status: 404, headers: cors });
    }
    if (!isAllowedOrigin(origin)) {
      return new Response('Forbidden', { status: 403 });
    }
    const roomName = (m[2] ? `${kind}--${m[2]}` : kind).toLowerCase();
    const id = env.ROOM.idFromName(roomName);
    const fwd = new URL(request.url);
    fwd.searchParams.set('room', roomName);
    return env.ROOM.get(id).fetch(new Request(fwd, request));
  },
};
