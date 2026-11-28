// いろいろボタン: ゆうえんち ゾーン の でっかい のれる ゆうぐ（ひだり: のりもの / みぎ: やたい・あそび）
// のりもの は ぜんぶ のって いっしょに うごける！ じめんを タップすると おりる。
window.ParkToys = (() => {
  function build(ctx) {
    const { world, place, addProp, arch, lamp, tone, equip, hopChr, board, canBoard, setRidePos, isNight, U: getU } = ctx;
    const { left: LZ, right: RZ } = ctx.zones;
    const toys = [];
    const boardZones = []; // タップしたら のりばへ あるく ゾーン { hit(x, y), to }

    function makeZoneBase(z, cls, archEm, bg, bd) {
      const el = document.createElement('div');
      el.className = 'pzone ' + cls;
      world.appendChild(el);
      arch(z.cx, z.y + 0.35, archEm, bg, bd, false);
      for (const dy of [5, 14, 23, 32]) {
        lamp(z.x + 0.55, z.y + dy);
        lamp(z.x + z.w - 0.55, z.y + dy);
      }
      toys.push({
        resize(U) {
          place(el, z.x, z.y);
          el.style.width = (z.w * U).toFixed(1) + 'px';
          el.style.height = (z.h * U).toFixed(1) + 'px';
        },
        tick() {},
      });
    }

    makeZoneBase(LZ, 'ride-zone', '🦄', '#dff4ff', '#65b8f5');
    makeZoneBase(RZ, 'fest-zone', '🍿', '#fff0db', '#ff9f43');

    // =========================================================================
    // ひだり ゾーン（でっかい のれる のりもの 4しゅるい）
    // =========================================================================

    // 1. でっかい メリーゴーラウンド（ride id = 1, slot = 0..7: うま/ユニコーンに のる！）
    const carousel = (() => {
      const cx = LZ.cx, cy = LZ.y + 5.6, rx = 2.85, ry = 1.85;
      const el = document.createElement('div');
      el.className = 'carousel';
      el.innerHTML = '<i class="cfloor"></i><div class="chorses"></div><div class="ccanopy"><i></i></div>';
      const horsesEl = el.querySelector('.chorses');
      const mounts = ['🐴', '🦄', '🐴', '🦄', '🐴', '🦄', '🐴', '🦄'].map((em, i) => {
        const h = document.createElement('i');
        h.className = 'ch';
        h.innerHTML = `<b style="animation-delay:${(-i * 0.25).toFixed(2)}s">${em}</b>`;
        horsesEl.appendChild(h);
        return { el: h, a0: (i / 8) * Math.PI * 2, x: cx, y: cy };
      });
      addProp(el, cx, cy, 62);
      const waltz = [523, 659, 784, 659, 587, 740, 880, 740];
      toys.push({
        resize() {},
        tick(all, now) {
          const U = getU();
          const ang = ((Date.now() % 13000) / 13000) * Math.PI * 2;
          mounts.forEach((m) => {
            const a = m.a0 + ang;
            const hx = Math.cos(a) * rx, hy = Math.sin(a) * ry;
            m.x = cx + hx; m.y = cy + hy;
            m.el.style.left = (hx * U).toFixed(1) + 'px';
            m.el.style.top = (hy * U).toFixed(1) + 'px';
            m.el.style.zIndex = String(10 + Math.round((hy + 3) * 10));
            m.el.style.setProperty('--dir', Math.sin(a) < 0 ? '-1' : '1');
          });
          // いちばん ちかい あいている うまに のる
          const me = ctx.me();
          if (me && canBoard(me, now) && Math.hypot((me.x - cx) / 3.7, (me.y - cy) / 2.65) < 1) {
            const used = new Set(all.filter(c => c.ride && c.ride.id === 1).map(c => c.ride.slot));
            let best = 0, bd = 1e9;
            mounts.forEach((m, i) => {
              const d = Math.hypot(m.x - me.x, m.y - me.y) + (used.has(i) ? 50 : 0);
              if (d < bd) { bd = d; best = i; }
            });
            board(me, 1, best, true);
          }
          for (const c of all) {
            const riding = !!(c.ride && c.ride.id === 1);
            c.el.classList.toggle('ride', riding);
            if (riding) {
              const m = mounts[c.ride.slot % mounts.length];
              setRidePos(c, m.x, m.y - 0.16, 100 + Math.round(m.y * 10) + 5);
              if (now - (c.carT || 0) > 450) {
                c.carT = now;
                tone(c, waltz[Math.floor(now / 450) % waltz.length], 0.24, 'sine', 0.13);
              }
            } else c.carT = 0;
          }
        },
      });
      return { cx, cy };
    })();

    // 2. でっかい 2にん シーソー（ride id = 2, slot 0=ひだり / 1=みぎ: ほんとうに のって じょうげに ゆれる！）
    const seesaw = (() => {
      const cx = LZ.cx, cy = LZ.y + 12.2, seatR = 3.1;
      const el = document.createElement('div');
      el.className = 'seesaw';
      el.innerHTML = '<i class="sbase"></i><div class="sbeam"><i class="sseat l"></i><i class="sseat r"></i></div>';
      const beam = el.querySelector('.sbeam');
      addProp(el, cx, cy, 64);
      let rockT = 0, lastMode = '', curDeg = 0;
      boardZones.push(
        { hit: (x, y) => Math.hypot(x - (cx - seatR), y - cy) < 1.6, to: [cx - seatR, cy] },
        { hit: (x, y) => Math.hypot(x - (cx + seatR), y - cy) < 1.6, to: [cx + seatR, cy] },
      );
      toys.push({
        resize() {},
        tick(all, now) {
          const me = ctx.me();
          if (me && canBoard(me, now)) {
            if (Math.hypot(me.x - (cx - seatR), me.y - cy) < 1.45) board(me, 2, 0, true);
            else if (Math.hypot(me.x - (cx + seatR), me.y - cy) < 1.45) board(me, 2, 1, true);
          }
          const ridersL = all.filter(c => c.ride && c.ride.id === 2 && c.ride.slot === 0);
          const ridersR = all.filter(c => c.ride && c.ride.id === 2 && c.ride.slot === 1);
          const onL = ridersL[0] || null, onR = ridersR[0] || null;
          const mode = (onL && onR) ? 'duo' : onL ? 'left' : onR ? 'right' : 'idle';
          let targetDeg = 0;
          if (mode === 'left') targetDeg = -15;
          else if (mode === 'right') targetDeg = 15;
          else if (mode === 'duo') {
            targetDeg = Math.sin(now / 340) * 18;
            if (now - rockT > 680) {
              rockT = now;
              const hi = Math.sin(now / 340) > 0;
              tone(onL === me ? onL : onR, hi ? 659 : 523, 0.2, 'triangle', 0.17, hi ? 880 : 392);
              const sp = document.createElement('i');
              sp.className = 'pnote'; sp.textContent = hi ? '⭐' : '💖';
              place(sp, cx + (hi ? seatR * 0.85 : -seatR * 0.85), cy - 1.4); world.appendChild(sp);
              setTimeout(() => sp.remove(), 950);
            }
          }
          if (mode !== lastMode && (mode === 'left' || mode === 'right')) {
            tone(onL || onR, mode === 'left' ? 440 : 554, 0.2, 'triangle', 0.16, mode === 'left' ? 340 : 680);
          }
          lastMode = mode;
          curDeg += (targetDeg - curDeg) * 0.18;
          beam.style.transform = `rotate(${curDeg.toFixed(1)}deg)`;
          el.classList.toggle('duo', mode === 'duo');
          // のっている どうぶつも イスの うごきに あわせて じょうげ！
          const rad = curDeg * Math.PI / 180;
          const lx = cx - Math.cos(rad) * seatR, ly = cy - Math.sin(rad) * seatR - 0.18;
          const rx = cx + Math.cos(rad) * seatR, ry = cy + Math.sin(rad) * seatR - 0.18;
          for (const c of ridersL) setRidePos(c, lx, ly, 100 + Math.round(cy * 10) + 10);
          for (const c of ridersR) setRidePos(c, rx, ry, 100 + Math.round(cy * 10) + 10);
        },
      });
      return { cx, cy, seatR };
    })();

    // 3. でっかい スカイ ジェットコースター（ride id = 3, slot 0..2: のって 8のじ ループを びゅーん！）
    const coaster = (() => {
      const cx = LZ.cx, cy = LZ.y + 21.4, rx = 5.1, ry = 5.3;
      const platX = cx, platY = cy + ry * 0.92;
      const track = document.createElement('div');
      track.className = 'coaster';
      track.innerHTML = `<svg viewBox="-560 -560 1120 1120" preserveAspectRatio="none">
        <path class="c-shadow" d="M 0 -480 C 490 -480 490 -40 0 0 C -490 40 -490 480 0 480 C 490 480 490 40 0 0 C -490 -40 -490 -480 0 -480 Z"/>
        <path class="c-rail"   d="M 0 -480 C 490 -480 490 -40 0 0 C -490 40 -490 480 0 480 C 490 480 490 40 0 0 C -490 -40 -490 -480 0 -480 Z"/>
        <path class="c-dash"   d="M 0 -480 C 490 -480 490 -40 0 0 C -490 40 -490 480 0 480 C 490 480 490 40 0 0 C -490 -40 -490 -480 0 -480 Z"/>
      </svg><div class="cplat"><span>⭐</span></div>`;
      addProp(track, cx, cy, 58);

      const cars = ['#ff5a8a', '#ffd23f', '#4fc3f7'].map((col, i) => {
        const el = document.createElement('i');
        el.className = 'ccar' + (i === 0 ? ' head' : '');
        el.style.setProperty('--cc', col);
        world.appendChild(el);
        return { el, x: platX, y: platY };
      });
      const pt = (t) => [cx + Math.sin(t * 2) * rx * 0.88, cy - Math.cos(t) * ry * 0.9];
      boardZones.push({
        hit: (x, y) => Math.abs(x - cx) < rx * 1.05 && Math.abs(y - cy) < ry * 1.05,
        to: [platX, platY],
      });
      let trailT = 0;
      toys.push({
        resize(U) {
          track.style.width = (rx * 2.2 * U).toFixed(1) + 'px';
          track.style.height = (ry * 2.2 * U).toFixed(1) + 'px';
        },
        tick(all, now) {
          const t0 = ((Date.now() % 8000) / 8000) * Math.PI * 2;
          cars.forEach((car, i) => {
            const t = t0 - i * 0.14;
            const [x, y] = pt(t);
            const [nx, ny] = pt(t + 0.04);
            const deg = Math.atan2(ny - y, nx - x) * 180 / Math.PI;
            car.x = x; car.y = y;
            place(car.el, x, y);
            car.el.style.transform = `translate(-50%,-50%) rotate(${deg.toFixed(1)}deg)`;
            car.el.style.zIndex = String(100 + Math.round(y * 10));
          });
          // のりば ⭐ に つくと コースターに のる！
          const me = ctx.me();
          if (me && canBoard(me, now) && Math.hypot(me.x - platX, me.y - platY) < 1.65) {
            const used = new Set(all.filter(c => c.ride && c.ride.id === 3).map(c => c.ride.slot));
            const slot = [0, 1, 2].find(s => !used.has(s)) ?? 0;
            board(me, 3, slot, true);
            [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(me, f, 0.18, 'triangle', 0.16), i * 75));
          }
          // のっている どうぶつは シャリョウの なかに すわって びゅーん！
          for (const c of all) {
            if (c.ride && c.ride.id === 3) {
              const car = cars[c.ride.slot % cars.length];
              setRidePos(c, car.x, car.y + 0.24, 100 + Math.round(car.y * 10) + 6);
              if (now - trailT > 320) {
                trailT = now;
                const sp = document.createElement('i');
                sp.className = 'pnote'; sp.textContent = Math.random() < 0.5 ? '✨' : '⭐';
                place(sp, car.x, car.y - 0.35); world.appendChild(sp);
                setTimeout(() => sp.remove(), 650);
              }
              if (now - (c.coSnd || 0) > 1500) {
                c.coSnd = now;
                tone(c, 420 + (cy - car.y) * 55, 0.22, 'sine', 0.12, 660 + (cy - car.y) * 65);
              }
            }
          }
        },
      });
      return { cx, cy, platX, platY };
    })();

    // 4. でっかい かんらんしゃ（ride id = 4, slot 0..7: ゴンドラに のって そらへ あがる！）
    const gwheel = (() => {
      const cx = LZ.cx, cy = LZ.y + 33.4, R = 3.65;
      const gateX = cx, gateY = cy + R + 0.15;
      const el = document.createElement('div');
      el.className = 'gwheel';
      const cols = ['#ff5a8a', '#ff9f1c', '#ffd23f', '#7ed957', '#4fc3f7', '#5c8aff', '#b388ff', '#ff7eb6'];
      el.innerHTML = '<i class="gw-leg l"></i><i class="gw-leg r"></i><div class="gw-rim">' +
        cols.map((_, i) => `<i class="gw-spoke" style="--a:${i * 45}deg"></i>`).join('') +
        '</div><i class="gw-hub"></i><div class="gw-gate"><span>⭐</span></div>';
      const rim = el.querySelector('.gw-rim');
      addProp(el, cx, cy, 65);
      // ゴンドラ 8き は JS で まっすぐ ぶらさがる（なかの どうぶつも まっすぐ そらへ！）
      const pods = cols.map((col, i) => {
        const p = document.createElement('div');
        p.className = 'gw-cab';
        p.style.setProperty('--pc', col);
        p.innerHTML = '<i class="gw-bar"></i><b class="gw-box"></b>';
        world.appendChild(p);
        return { el: p, a0: (i / 8) * Math.PI * 2, x: cx, y: cy };
      });
      boardZones.push({
        hit: (x, y) => Math.hypot(x - cx, y - cy) < R + 1.0,
        to: [gateX, gateY],
      });
      toys.push({
        resize() {},
        tick(all, now) {
          const ang = ((Date.now() % 18000) / 18000) * Math.PI * 2;
          rim.style.transform = `translate(-50%,-50%) rotate(${(ang * 180 / Math.PI).toFixed(2)}deg)`;
          pods.forEach((p) => {
            const a = p.a0 + ang;
            p.x = cx + Math.cos(a) * R;
            p.y = cy + Math.sin(a) * R;
            place(p.el, p.x, p.y);
            p.el.style.zIndex = String(100 + Math.round(p.y * 10) - 2);
          });
          // いちばん したの のりば ⭐ に くると、いちばん ちかい ゴンドラに のる！
          const me = ctx.me();
          if (me && canBoard(me, now) && Math.hypot(me.x - gateX, me.y - gateY) < 1.8) {
            const used = new Set(all.filter(c => c.ride && c.ride.id === 4).map(c => c.ride.slot));
            let best = 0, bd = 1e9;
            pods.forEach((p, i) => {
              const d = Math.hypot(p.x - gateX, p.y - gateY) + (used.has(i) ? 50 : 0);
              if (d < bd) { bd = d; best = i; }
            });
            board(me, 4, best, true);
            [659, 784, 988, 1319].forEach((f, i) => setTimeout(() => tone(me, f, 0.22, 'sine', 0.14), i * 110));
          }
          for (const c of all) {
            if (c.ride && c.ride.id === 4) {
              const p = pods[c.ride.slot % pods.length];
              setRidePos(c, p.x, p.y + 1.02, 100 + Math.round(p.y * 10) + 4);
              // いちばん てっぺん で キラキラ チャイム！
              if (p.y < cy - R * 0.9 && now - (c.peakT || 0) > 4000) {
                c.peakT = now;
                [784, 1047, 1319].forEach((f, i) => setTimeout(() => tone(c, f, 0.25, 'sine', 0.14), i * 100));
                const sp = document.createElement('i');
                sp.className = 'pnote'; sp.textContent = '🌟';
                place(sp, p.x, p.y - 0.8); world.appendChild(sp);
                setTimeout(() => sp.remove(), 1100);
              }
            }
          }
        },
      });
      return { cx, cy, R, gateX, gateY };
    })();

    // =========================================================================
    // みぎ ゾーン（やたい・あそび）
    // =========================================================================

    const STALLS = [
      { kind: 'popcorn', em: '🍿', x: RZ.cx - 2.15, y: RZ.y + 4.4, c1: '#ff6b6b', c2: '#c0392b', notes: [523, 659, 784] },
      { kind: 'ice',     em: '🍦', x: RZ.cx + 2.15, y: RZ.y + 4.4, c1: '#ff8fb8', c2: '#c95a85', notes: [659, 784, 1047] },
      { kind: 'wand',    em: '🪄', x: RZ.cx - 2.15, y: RZ.y + 8.8, c1: '#b388ff', c2: '#6a3fc2', notes: [784, 988, 1175, 1568] },
      { kind: 'crown',   em: '👑', x: RZ.cx + 2.15, y: RZ.y + 8.8, c1: '#ffd23f', c2: '#c48f00', notes: [523, 659, 784, 1047] },
    ];
    STALLS.forEach((st) => {
      const el = document.createElement('div');
      el.className = 'fstall';
      el.style.setProperty('--c1', st.c1); el.style.setProperty('--c2', st.c2);
      el.innerHTML = `<i class="fs-floor"></i><i class="fs-poles"></i><i class="fs-roof"></i><i class="fs-counter"></i><b>${st.em}</b>`;
      addProp(el, st.x, st.y, 100 + Math.round(st.y * 10) - 4);
      st.el = el;
    });
    toys.push({
      resize() {},
      tick(all, now) {
        for (const c of all) {
          if (c.ride) continue;
          const stOn = c.stOn || (c.stOn = new Set());
          for (const st of STALLS) {
            const inside = Math.hypot(c.x - st.x, c.y - (st.y + 0.3)) < 1.25;
            if (inside && !stOn.has(st)) {
              stOn.add(st);
              if (c.itemKind !== st.kind) {
                equip(c, st.kind, st.em, false);
                st.el.classList.remove('pop'); void st.el.offsetWidth; st.el.classList.add('pop');
                setTimeout(() => st.el.classList.remove('pop'), 500);
                st.notes.forEach((f, i) => setTimeout(() => tone(c, f, 0.2, 'sine', 0.16), i * 80));
                for (let k = 0; k < 5; k++) {
                  const p = document.createElement('i');
                  p.className = 'pnote'; p.textContent = st.kind === 'popcorn' ? '🍿' : '✨';
                  place(p, st.x + (Math.random() - 0.5) * 1.4, st.y - 0.7 - Math.random() * 0.5);
                  world.appendChild(p);
                  setTimeout(() => p.remove(), 900);
                }
              }
            } else if (!inside) stOn.delete(st);
          }
          if (c.itemKind === 'wand' && isNight() && Math.hypot(c.tx - c.x, c.ty - c.y) > 0.15 && now - (c.wandT || 0) > 260) {
            c.wandT = now;
            const s = document.createElement('i');
            s.className = 'pnote'; s.textContent = '✨';
            place(s, c.x + (Math.random() - 0.5) * 0.4, c.y - 0.4);
            world.appendChild(s);
            setTimeout(() => s.remove(), 800);
          }
        }
      },
    });

    // シャボンだま マシン
    (() => {
      const cx = RZ.cx, cy = RZ.y + 15.8;
      const el = document.createElement('div');
      el.className = 'bmachine';
      el.innerHTML = '<i class="bm-pad"></i><i class="bm-body">🫧</i>';
      addProp(el, cx, cy, 100 + Math.round(cy * 10) - 2);
      const bubbles = [];
      let spawnT = 0;
      toys.push({
        resize() {},
        tick(all, now, dt) {
          let nearC = null;
          for (const c of all) if (!c.ride && Math.hypot(c.x - cx, c.y - cy) < 2.2) { nearC = c; break; }
          if (nearC && now - spawnT > 1100 && bubbles.length < 16) {
            spawnT = now;
            el.classList.remove('blow'); void el.offsetWidth; el.classList.add('blow');
            setTimeout(() => el.classList.remove('blow'), 450);
            tone(nearC, 540, 0.16, 'sine', 0.14, 960);
            for (let i = 0; i < 6; i++) {
              const bEl = document.createElement('i');
              bEl.className = 'sbub';
              const sz = 0.45 + Math.random() * 0.35;
              bEl.style.setProperty('--bs', sz.toFixed(2));
              world.appendChild(bEl);
              const ang = Math.random() * Math.PI * 2;
              const spd = 0.55 + Math.random() * 0.65;
              bubbles.push({ el: bEl, x: cx, y: cy - 0.4, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd - 0.15, born: now, life: 5500 + Math.random() * 2500 });
            }
          }
          for (let i = bubbles.length - 1; i >= 0; i--) {
            const b = bubbles[i];
            b.x += b.vx * dt; b.y += b.vy * dt;
            b.vx *= 0.992; b.vy *= 0.992;
            place(b.el, b.x, b.y);
            let poppedBy = null;
            if (now - b.born > 550) {
              for (const c of all) if (Math.hypot(c.x - b.x, c.y - b.y) < 0.75) { poppedBy = c; break; }
            }
            if (poppedBy || now - b.born > b.life) {
              if (poppedBy) {
                tone(poppedBy, 900 + Math.random() * 500, 0.08, 'sine', 0.16, 1500);
                const sp = document.createElement('i');
                sp.className = 'pnote'; sp.textContent = '✨';
                place(sp, b.x, b.y); world.appendChild(sp);
                setTimeout(() => sp.remove(), 550);
              }
              b.el.remove();
              bubbles.splice(i, 1);
            }
          }
        },
      });
    })();

    // フォトスポット
    (() => {
      const cx = RZ.cx, cy = RZ.y + 24.4;
      const el = document.createElement('div');
      el.className = 'photospot';
      el.innerHTML = '<i class="ph-arch"><b>💐 ✨ 💐</b></i><i class="ph-stage"></i><i class="ph-cam"><b></b><u></u></i>';
      addProp(el, cx, cy, 62);
      let snapT = 0;
      toys.push({
        resize() {},
        tick(all, now) {
          const onStage = all.filter(c => !c.ride && Math.hypot(c.x - cx, c.y - cy) < 1.65);
          if (onStage.length && now - snapT > 3400) {
            snapT = now;
            const duo = onStage.length >= 2;
            el.classList.remove('flash', 'duo'); void el.offsetWidth;
            el.classList.add('flash');
            if (duo) el.classList.add('duo');
            setTimeout(() => el.classList.remove('flash', 'duo'), 1400);
            const fl = document.createElement('i');
            fl.className = 'pflash' + (duo ? ' duo' : '');
            place(fl, cx, cy - 0.6); world.appendChild(fl);
            setTimeout(() => fl.remove(), 750);
            const lead = onStage.find(c => c === ctx.me()) || onStage[0];
            tone(lead, 1200, 0.06, 'square', 0.12, 600);
            setTimeout(() => tone(lead, 1600, 0.09, 'sine', 0.16), 90);
            if (duo) [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(lead, f, 0.22, 'triangle', 0.15), 140 + i * 90));
            for (const c of onStage) hopChr(c, c === ctx.me());
            const ems = duo ? ['💖', '🌈', '🎉', '✨', '💐', '⭐'] : ['🎉', '✨', '💐', '⭐'];
            for (let i = 0; i < (duo ? 10 : 6); i++) {
              const p = document.createElement('i');
              p.className = 'pnote'; p.textContent = ems[i % ems.length];
              place(p, cx + (Math.random() - 0.5) * 3.4, cy - 0.8 - Math.random() * 1.4);
              world.appendChild(p);
              setTimeout(() => p.remove(), 1050);
            }
          }
        },
      });
    })();

    // スターライト ダンス ステージ
    (() => {
      const cx = RZ.cx, cy = RZ.y + 32.8;
      const pads = [
        [-1.35, -0.7, '#ff5a8a', 523.25], [0, -0.7, '#ffd23f', 659.25], [1.35, -0.7, '#7ed957', 783.99],
        [-1.35,  0.7, '#4fc3f7', 880.00], [0,  0.7, '#b388ff', 987.77], [1.35,  0.7, '#ff9f1c', 1046.5],
      ].map(([dx, dy, col, freq], i) => {
        const el = document.createElement('i');
        el.className = 'dpad';
        el.style.setProperty('--dc', col);
        el.textContent = ['⭐', '🎵', '✨', '🌟', '🎶', '💖'][i];
        addProp(el, cx + dx, cy + dy, 56);
        return { el, x: cx + dx, y: cy + dy, freq };
      });
      toys.push({
        resize() {},
        tick(all) {
          const lit = new Set();
          for (const c of all) {
            if (c.ride) { c.dp = null; continue; }
            let hit = null;
            for (const p of pads) if (Math.abs(c.x - p.x) < 0.68 && Math.abs(c.y - p.y) < 0.68) { hit = p; break; }
            if (hit) lit.add(hit);
            if (hit && c.dp !== hit) {
              tone(c, hit.freq, 0.28, 'triangle', 0.18);
              tone(c, hit.freq * 1.5, 0.16, 'sine', 0.08);
            }
            c.dp = hit;
          }
          for (const p of pads) p.el.classList.toggle('on', lit.has(p));
        },
      });
    })();

    return {
      toys,
      zones: { left: LZ, right: RZ },
      rides: { carousel, seesaw, coaster, gwheel },
      stalls: STALLS,
      boardPoint(x, y) {
        for (const bz of boardZones) if (bz.hit(x, y)) return bz.to;
        return null;
      },
      resize(U) { for (const t of toys) t.resize(U); },
      tick(all, now, dt) { for (const t of toys) t.tick(all, now, dt); },
    };
  }

  return { build };
})();
