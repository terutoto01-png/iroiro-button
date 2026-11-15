// いろいろボタン 共通ヘルパー（file:// でも動くようにクラシックスクリプト）

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ---- おと（Web Audio で合成。音声ファイル不要） ----
const Sfx = (() => {
  let ctx = null, master = null, noiseBuf = null;
  let level = 1;
  try { const v = parseFloat(localStorage.getItem('iroiro-volume')); if (!isNaN(v)) level = v; } catch (e) {}
  function ac() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.7 * level;
      // れんだで おとが かさなっても われないように
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12; comp.knee.value = 12; comp.ratio.value = 6;
      master.connect(comp).connect(ctx.destination);
      // ノイズは 1かいだけ つくって つかいまわす（れんだで おもくならないように）
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  // どうじに なる おとの かずを おさえる（れんだ たいさく）
  const MAX_VOICES = 36;
  let voices = [];
  function room(c, end) {
    const now = c.currentTime;
    voices = voices.filter(e => e > now);
    if (voices.length >= MAX_VOICES) return false;
    voices.push(end);
    return true;
  }
  // 単音。slideTo を指定すると周波数がすべる
  function tone(freq, dur = 0.3, type = 'sine', vol = 0.25, when = 0, slideTo = null) {
    const c = ac(), t = c.currentTime + when;
    if (!room(c, t + dur)) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }
  // ノイズ（ばーん、しゅー など）
  function noise(dur = 0.4, vol = 0.4, filterFreq = 1200, when = 0, filterType = 'lowpass') {
    const c = ac(), t = c.currentTime + when;
    dur = Math.min(dur, 1.9);
    if (!room(c, t + dur)) return;
    const src = c.createBufferSource(); src.buffer = noiseBuf;
    const f = c.createBiquadFilter(); f.type = filterType; f.frequency.value = filterFreq;
    const g = c.createGain();
    // だんだん ちいさく（まえの (1-x)^2 に ちかい かたち）
    g.gain.setValueAtTime(vol, t);
    g.gain.setTargetAtTime(0.0001, t, dur / 3.5);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random() * (2 - dur), dur);
  }
  // 音量（0〜1）。全ページ共通でブラウザに覚えておく
  function setLevel(v) {
    level = v;
    if (master) master.gain.setTargetAtTime(0.7 * v, ctx.currentTime, 0.02);
    if (v === 0 && 'speechSynthesis' in window) speechSynthesis.cancel();
    try { localStorage.setItem('iroiro-volume', String(v)); } catch (e) {}
  }
  return {
    ac, tone, noise, setLevel,
    get level() { return level; },
    out() { ac(); return master; }, // 自前で音を作るページはここにつなぐ
    pop()   { tone(rand(500, 800), 0.12, 'sine', 0.35, 0, rand(1200, 1800)); },
    boing() { tone(180, 0.35, 'triangle', 0.3, 0, 420); },
    chime() { [0, 4, 7, 12].forEach((s, i) => tone(523.25 * Math.pow(2, s / 12), 0.5, 'triangle', 0.18, i * 0.07)); },
    yay()   { [0, 4, 7, 12, 16].forEach((s, i) => tone(392 * Math.pow(2, s / 12), 0.35, 'square', 0.08, i * 0.06)); },
  };
})();

// ---- しゃべる（ブラウザの音声合成） ----
function speak(text, rate = 1.0, pitch = 1.3) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  if (Sfx.level === 0) return;
  u.lang = 'ja-JP'; u.rate = rate; u.pitch = pitch; u.volume = Sfx.level;
  const ja = speechSynthesis.getVoices().find(v => v.lang && v.lang.startsWith('ja'));
  if (ja) u.voice = ja;
  speechSynthesis.speak(u);
}
if ('speechSynthesis' in window) speechSynthesis.getVoices();

// ---- キャンバスを画面いっぱいに（高DPI対応） ----
function fitCanvas(canvas, ctx2d) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
  if (ctx2d) ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  return dpr;
}

// ---- ふわっと文字 ----
function popText(text, x, y, color = '#fff', size = 48) {
  const el = document.createElement('div');
  el.className = 'pop-text';
  el.textContent = text;
  el.style.left = x + 'px'; el.style.top = y + 'px';
  el.style.color = color; el.style.fontSize = size + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

// ---- 押した見た目（キーボードやプログラムからも） ----
function flashPress(btn) {
  btn.classList.add('pressed');
  setTimeout(() => btn.classList.remove('pressed'), 90);
}

// ---- 音量ボタン と もどるボタン ----
window.addEventListener('DOMContentLoaded', () => {
  const LEVELS = [[1, '🔊'], [0.5, '🔉'], [0.2, '🔈'], [0, '🔇']];
  const vol = document.createElement('button');
  vol.className = 'vol';
  let li = LEVELS.findIndex(l => l[0] === Sfx.level); if (li < 0) li = 0;
  vol.textContent = LEVELS[li][1];
  vol.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    li = (li + 1) % LEVELS.length;
    Sfx.setLevel(LEVELS[li][0]);
    vol.textContent = LEVELS[li][1];
    if (LEVELS[li][0] > 0) Sfx.tone(660, 0.12, 'sine', 0.3);
  });
  document.body.appendChild(vol);

  if (document.body.dataset.noBack !== undefined) return;
  const a = document.createElement('a');
  a.href = 'index.html'; a.className = 'back'; a.textContent = '🏠';
  document.body.appendChild(a);
});

// ---- WebGPU の準備（使えないときは null を返す） ----
async function initWebGPU(canvas) {
  try {
    if (!navigator.gpu) return null;
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    const ctx = canvas.getContext('webgpu');
    const format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format, alphaMode: 'opaque' });
    return { device, ctx, format };
  } catch (e) {
    console.warn('WebGPU 初期化失敗', e);
    return null;
  }
}

// ---- HTML-in-Canvas（実験的API）の準備 ----
// 本物のボタン要素をキャンバスに描く。
const HIC = {
  supported: typeof CanvasRenderingContext2D !== 'undefined' &&
    ('drawElementImage' in CanvasRenderingContext2D.prototype ||
     'drawElement' in CanvasRenderingContext2D.prototype),
  // el をキャンバスの子にする（新旧どちらの仕様にも対応）
  attach(canvas, el) {
    canvas.setAttribute('layoutsubtree', '');
    canvas.setAttribute('content', 'drawable');
    el.setAttribute('drawable', '');
    canvas.appendChild(el);
  },
  // 返り値: 描けたら true
  draw(ctx, el, ...args) {
    const fn = ctx.drawElementImage || ctx.drawElement;
    try {
      const m = fn.call(ctx, el, ...args);
      // 古い仕様は DOMMatrix を返すので、当たり判定用に要素へ適用
      if (m && typeof m === 'object' && 'm11' in m && !ctx.updateElementGeometry) {
        el.style.transform = m.toString();
      }
      return true;
    } catch (e) { return false; }
  },
  // ボタンの見た目を画像（キャンバス）に写し取る。たくさん描くときはこれを使うと軽い
  // hues を渡すと色ちがいも作る
  capture(ctx, canvas, el, dpr, hues = []) {
    const w = el.offsetWidth, h = el.offsetHeight;
    const pw = Math.ceil(w * dpr), ph = Math.ceil(h * dpr);
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w + 2, h + 2);
    const ok = HIC.draw(ctx, el, 0, 0);
    ctx.restore();
    if (!ok) return null;
    const base = document.createElement('canvas');
    base.width = pw; base.height = ph;
    base.getContext('2d').drawImage(canvas, 0, 0, pw, ph, 0, 0, pw, ph);
    const out = { w, h, base, tints: [] };
    for (const hue of hues) {
      const c = document.createElement('canvas');
      c.width = pw; c.height = ph;
      const x = c.getContext('2d');
      x.filter = `hue-rotate(${hue}deg)`;
      x.drawImage(base, 0, 0);
      out.tints.push(c);
    }
    return out;
  },
  // 毎フレーム cb を呼ぶ（paint イベントがあればそれを使う）
  loop(canvas, cb) {
    if ('requestPaint' in canvas) {
      canvas.addEventListener('paint', () => { cb(); requestAnimationFrame(() => canvas.requestPaint()); });
      canvas.requestPaint();
    } else {
      const f = () => { cb(); requestAnimationFrame(f); };
      requestAnimationFrame(f);
    }
  },
};

// ---- でんしゃを つくる（ひだり→みぎ むき。はんたいは scaleX(-1)） ----
const TRAINS = {
  local:      { body: '#e8edf2', stripe: '#2bb24c', head: 'round', cars: 4 },
  orange:     { body: '#f08a24', stripe: '#fff3', head: 'round', cars: 4 },
  yellow:     { body: '#ffd400', stripe: '#1e5bbf', head: 'nose', cars: 5 },
  shinkansen: { body: '#f7f7f7', stripe: '#1f4fbf', head: 'nose', cars: 6 },
  sl:         { body: '#2b2b2b', stripe: '#c0392b', head: 'loco', cars: 4 },
};
function makeTrain(kind) {
  const k = TRAINS[kind];
  const el = document.createElement('div');
  el.className = 'train';
  el.style.setProperty('--body', k.body); el.style.setProperty('--stripe', k.stripe);
  for (let i = 0; i < k.cars; i++) {
    const c = document.createElement('div');
    const head = i === k.cars - 1;
    c.className = 'car' + (head ? ' ' + k.head : (k.head === 'loco' ? ' brown' : ''));
    c.innerHTML = '<span class="wheel" style="left:22px"></span><span class="wheel" style="right:22px"></span>' + (head && k.head === 'loco' ? '<span class="chimney"></span>' : '');
    el.appendChild(c);
  }
  // うしろの せんとうも まるく
  if (k.head !== 'loco') el.firstChild.style.borderRadius = k.head === 'nose' ? '120px 10px 10px 10px / 70px 10px 10px 10px' : '36px 10px 10px 10px';
  return el;
}

// ---- iPad / iPhone むけ: さいしょに ゆびを はなしたときに 音と声を つかえるようにする ----
(() => {
  let done = false;
  const unlock = () => {
    if (done) return; done = true;
    try {
      const c = Sfx.ac();
      const b = c.createBuffer(1, 1, 22050), s = c.createBufferSource();
      s.buffer = b; s.connect(c.destination); s.start(0);
    } catch (e) {}
    try { if ('speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } } catch (e) {}
    for (const t of ['pointerup', 'touchend', 'click']) removeEventListener(t, unlock, true);
  };
  for (const t of ['pointerup', 'touchend', 'click']) addEventListener(t, unlock, true);
})();

// ---- えもじを いちど だけ 画像にして つかいまわす（キャンバスで たくさん描くと かるい） ----
const EmojiSprite = (() => {
  const cache = new Map();
  const BASE = 128; // この大きさで 1かい 描いておき、あとは のびちぢみ
  return function (e) {
    let c = cache.get(e);
    if (!c) {
      c = document.createElement('canvas');
      c.width = c.height = BASE;
      const x = c.getContext('2d');
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.font = `${BASE * 0.8}px serif`;
      x.fillStyle = '#000';
      x.fillText(e, BASE / 2, BASE / 2 + BASE * 0.04);
      cache.set(e, c);
    }
    return c;
  };
})();
// (cx, cy) を まんなかに、はば size で えもじを かく
function drawEmoji(ctx, e, cx, cy, size) {
  const s = size * 1.25;
  ctx.drawImage(EmojiSprite(e), cx - s / 2, cy - s / 2, s, s);
}

// ---- iPad: かくだい と ひっぱり を とめる ----
// メニュー（<body data-scroll>）は たてスクロールだけ できる。ほかの ページは まったく うごかない。
(() => {
  const canScroll = document.body && document.body.hasAttribute('data-scroll');
  document.documentElement.classList.add(canScroll ? 'can-scroll' : 'no-scroll');
  const stop = (e) => e.preventDefault();
  // Safari の ピンチ（gesture*）は touch-action を むしすることがあるので ちょくせつ とめる
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, stop, { passive: false });
  document.addEventListener('dblclick', stop, { passive: false });
  document.addEventListener('touchmove', (e) => {
    if (!canScroll || e.touches.length > 1) e.preventDefault(); // スクロールしない ページ と、2本ゆびは とめる
  }, { passive: false });
})();

// ---- PWA: Service Worker 登録 と 更新通知 ----
(() => {
  if (!('serviceWorker' in navigator)) return;
  let updateToast = null;

  function showUpdateToast() {
    if (updateToast) return;
    updateToast = document.createElement('button');
    updateToast.className = 'update-toast';
    updateToast.textContent = '🔄 あたらしくなったよ';
    updateToast.setAttribute('aria-label', 'ページを更新する');
    updateToast.addEventListener('pointerdown', (e) => e.stopPropagation());
    updateToast.addEventListener('click', () => window.location.reload());
    document.body.appendChild(updateToast);
    // 5秒後にふわっと表示
    requestAnimationFrame(() => updateToast.classList.add('show'));
  }

  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'UPDATE_READY') showUpdateToast();
  });

  navigator.serviceWorker.register('sw.js', { scope: './' })
    .then(reg => {
      console.log('[pwa] sw registered:', reg.scope, 'controller:', !!navigator.serviceWorker.controller);
      // すでに待機中の更新があれば即座に反映を促す
      if (reg.waiting) showUpdateToast();
      reg.addEventListener('updatefound', () => {
        const newSw = reg.installing;
        if (!newSw) return;
        newSw.addEventListener('statechange', () => {
          if (newSw.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateToast();
          }
        });
      });
    })
    .catch(err => console.warn('[pwa] sw registration failed', err));
})();
