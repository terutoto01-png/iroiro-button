// ゲームの きょうつう ぶひん: ハート・てんすう・いちばんの きろく・おしまい と やりなおし
// つかいかた:
//   const game = Game.create('pyon', { lives: 3, onStart() {...}, onOver() {...} });
//   game.state  … 'ready'（はじまるまえ）/ 'play' / 'over'
//   game.press() … ボタンを おしたとき。ready / over なら はじめる（true を かえす）
//   game.add(n) … てんすうを たす
//   game.hit()  … しっぱい。ハートが へる。0 で おしまい（true を かえす）
//   game.safe() … ぶつかっても だいじょうぶな じかん（チカチカ）か

const Game = (() => {
  function create(key, opt = {}) {
    const MAXL = opt.lives || 3;
    const hud = document.createElement('div');
    hud.className = 'hud';
    hud.innerHTML = '<span class="hearts"></span><span class="score">⭐<b>0</b></span><span class="best">👑<b>0</b></span>';
    document.body.appendChild(hud);
    const heartsEl = hud.querySelector('.hearts'), scoreEl = hud.querySelector('.score b'), bestEl = hud.querySelector('.best b');
    let best = 0;
    try { best = parseInt(localStorage.getItem('iroiro-best-' + key)) || 0; } catch (e) {}
    bestEl.textContent = best;

    const g = {
      state: 'ready', lives: MAXL, score: 0, best, safeUntil: 0, readyAt: 0,
      press() {
        if (g.state === 'play') return false;
        if (performance.now() < g.readyAt) return true; // おしまいの すぐあとは ちょっと まつ
        g.state = 'play'; g.lives = MAXL; g.score = 0; g.safeUntil = performance.now() + 1000;
        draw(); scoreEl.textContent = 0;
        Sfx.tone(523, 0.12, 'square', 0.08); Sfx.tone(784, 0.2, 'square', 0.08, 0.1);
        opt.onStart && opt.onStart();
        return true;
      },
      add(n = 1) {
        if (g.state !== 'play') return;
        g.score += n; scoreEl.textContent = g.score;
        scoreEl.parentElement.animate([{ scale: 1.4 }, { scale: 1 }], { duration: 250 });
        if (g.score === best + 1 && best > 0) { // きろく こえた！
          popText('👑', innerWidth / 2, 110, '#ffd23f', 80);
          Sfx.yay();
        }
      },
      safe() { return performance.now() < g.safeUntil; },
      hit() {
        if (g.state !== 'play' || g.safe()) return false;
        g.lives--; draw();
        heartsEl.animate([{ translate: '-8px 0' }, { translate: '8px 0' }, { translate: '0 0' }], { duration: 200, iterations: 2 });
        Sfx.tone(300, 0.3, 'sawtooth', 0.12, 0, 120);
        g.safeUntil = performance.now() + 1500;
        if (g.lives <= 0) { over(); return true; }
        return false;
      },
    };
    function draw() { heartsEl.textContent = '❤️'.repeat(Math.max(0, g.lives)) + '🤍'.repeat(Math.max(0, MAXL - g.lives)); }
    function over() {
      g.state = 'over'; g.readyAt = performance.now() + 1300;
      Sfx.noise(0.8, 0.7, 700); Sfx.tone(392, 0.25, 'triangle', 0.15); Sfx.tone(330, 0.25, 'triangle', 0.15, 0.25); Sfx.tone(262, 0.5, 'triangle', 0.15, 0.5);
      const record = g.score > best;
      if (record) {
        best = g.score; g.best = best; bestEl.textContent = best;
        try { localStorage.setItem('iroiro-best-' + key, String(best)); } catch (e) {}
      }
      setTimeout(() => {
        popText(record ? '👑 しんきろく！' : 'おしまい！', innerWidth / 2, innerHeight * 0.35, record ? '#ffd23f' : '#fff', 72);
        if (record) { Sfx.yay(); setTimeout(() => Sfx.chime(), 400); }
      }, 300);
      opt.onOver && opt.onOver(record);
    }
    draw();
    return g;
  }
  return { create };
})();
