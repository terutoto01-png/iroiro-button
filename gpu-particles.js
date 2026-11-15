// ひかりの つぶ エンジン（WebGPU）
// たくさんの つぶを コンピュートシェーダーで うごかし、ひかりを かさねて えがく。
// キャンバスは とうめいなので、うしろの CSS の はいけいが すけて みえる。
//
// つかいかた:
//   const sys = await GPUParticles.create(canvas, { count: 80000 });
//   sys.params.grav = [0, 300];         // じゅうりょく（px/s²）
//   sys.attractors = [{ x, y, s: 3000, swirl: 0 }];  // ひきよせ（s がマイナスで はじく）
//   sys.emit([{ x, y, vx, vy, r, g, b, life, size, shape }]);
//   sys.start((dt, t) => { ... まいフレーム ... });
// shape: 0 ひかりの たま / 1 てんめつ（ほたる）/ 2 はなびら / 3 きらきら（ほし）

const GPUParticles = (() => {
  const MAXA = 8;
  const STRUCT = /* wgsl */`
struct P { pos: vec2f, vel: vec2f, col: vec4f, misc: vec4f };
struct U { res: vec2f, dt: f32, time: f32, grav: vec2f, drag: f32, nAttr: f32,
           wind: vec2f, turb: f32, glow: f32, attr: array<vec4f, ${MAXA}> };
`;
  const SIM = STRUCT + /* wgsl */`
@group(0) @binding(0) var<storage, read_write> ps: array<P>;
@group(0) @binding(1) var<uniform> u: U;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= arrayLength(&ps)) { return; }
  var p = ps[i];
  if (p.col.a <= 0.0) { return; }
  let s = p.misc.z;
  var acc = u.grav + u.wind;
  acc = acc + u.turb * vec2f(sin(p.pos.y * 0.011 + u.time * 0.7 + s * 6.28), cos(p.pos.x * 0.013 + u.time * 0.6 + s * 3.1));
  for (var k = 0u; k < u32(u.nAttr); k = k + 1u) {
    let a = u.attr[k];
    let d = a.xy - p.pos;
    let r = length(d) + 20.0;
    let n = d / r;
    let fall = 1.0 / (1.0 + r / 220.0);
    acc = acc + n * a.z * fall + vec2f(-n.y, n.x) * a.w * fall;
  }
  p.vel = p.vel + acc * u.dt;
  p.vel = p.vel * pow(u.drag, u.dt);
  p.pos = p.pos + p.vel * u.dt;
  p.col.a = p.col.a - u.dt;
  ps[i] = p;
}`;
  const DRAW = STRUCT + /* wgsl */`
@group(0) @binding(0) var<storage, read> ps: array<P>;
@group(0) @binding(1) var<uniform> u: U;
struct VO { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) col: vec3f, @location(2) shape: f32 };
@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO {
  var corners = array<vec2f, 6>(vec2f(-1,-1), vec2f(1,-1), vec2f(-1,1), vec2f(-1,1), vec2f(1,-1), vec2f(1,1));
  let p = ps[ii];
  var o: VO;
  let c = corners[vi];
  o.uv = c;
  o.shape = p.misc.w;
  if (p.col.a <= 0.0) { o.pos = vec4f(2.0, 2.0, 0.0, 1.0); o.col = vec3f(0.0); return o; }
  let t = clamp(p.col.a / p.misc.y, 0.0, 1.0);
  let fade = smoothstep(0.0, 0.3, t) * min(1.0, (1.0 - t) * p.misc.y * 8.0 + 0.05);
  var bright = 1.0;
  var q = c;
  let s = p.misc.z;
  if (p.misc.w > 0.5 && p.misc.w < 1.5) { // ほたる: ゆっくり てんめつ
    bright = 0.15 + 0.85 * pow(0.5 + 0.5 * sin(u.time * (1.5 + s * 2.0) + s * 40.0), 3.0);
  }
  if (p.misc.w > 1.5 && p.misc.w < 2.5) { // はなびら: くるくる まわる
    let a = u.time * (1.0 + s * 2.5) + s * 20.0;
    let flip = 0.35 + 0.65 * abs(cos(u.time * (1.3 + s) + s * 9.0));
    let e = vec2f(c.x * flip, c.y);
    q = vec2f(e.x * cos(a) - e.y * sin(a), e.x * sin(a) + e.y * cos(a));
  }
  if (p.misc.w > 2.5) { // ほし: ちかちか
    bright = 0.6 + 0.4 * sin(u.time * 12.0 + s * 50.0);
  }
  let px = p.pos + q * p.misc.x;
  o.pos = vec4f(px.x / u.res.x * 2.0 - 1.0, 1.0 - px.y / u.res.y * 2.0, 0.0, 1.0);
  o.col = p.col.rgb * fade * bright;
  return o;
}
@fragment
fn fs(i: VO) -> @location(0) vec4f {
  let d = dot(i.uv, i.uv);
  var g = 0.0;
  if (i.shape > 1.5 && i.shape < 2.5) {        // はなびら（だえん）
    let e = length(i.uv * vec2f(1.0, 1.7));
    g = smoothstep(1.0, 0.55, e) * 0.9;
  } else if (i.shape > 2.5) {                   // ほし（じゅうじの ひかり）
    let a = abs(i.uv);
    g = exp(-a.x * 14.0) * exp(-a.y * 2.2) + exp(-a.y * 14.0) * exp(-a.x * 2.2) + exp(-d * 18.0);
  } else {                                      // ひかりの たま
    g = exp(-d * 4.5) + 0.6 * exp(-d * 30.0);
  }
  let c = i.col * g * u.glow;
  return vec4f(c, clamp(max(c.r, max(c.g, c.b)), 0.0, 1.0));
}`;

  async function create(canvas, opt = {}) {
    if (!navigator.gpu) throw new Error('WebGPU なし');
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    const ctx = canvas.getContext('webgpu');
    const format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format, alphaMode: 'premultiplied' });
    const N = opt.count || 60000, STRIDE = 12;
    const pbuf = device.createBuffer({ size: N * STRIDE * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const ubuf = device.createBuffer({ size: 48 + MAXA * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const sim = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: SIM }), entryPoint: 'main' } });
    const dmod = device.createShaderModule({ code: DRAW });
    const add = { srcFactor: 'one', dstFactor: 'one', operation: 'add' };
    const draw = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: dmod, entryPoint: 'vs' },
      fragment: { module: dmod, entryPoint: 'fs', targets: [{ format, blend: { color: add, alpha: add } }] },
    });
    const entries = [{ binding: 0, resource: { buffer: pbuf } }, { binding: 1, resource: { buffer: ubuf } }];
    const simBG = device.createBindGroup({ layout: sim.getBindGroupLayout(0), entries });
    const drawBG = device.createBindGroup({ layout: draw.getBindGroupLayout(0), entries });
    const resize = () => fitCanvas(canvas);
    resize(); addEventListener('resize', resize);

    let cursor = 0;
    const u = new Float32Array(12 + MAXA * 4);
    const sys = {
      N, device,
      params: { grav: [0, 0], drag: 0.5, wind: [0, 0], turb: 0, glow: 1 },
      attractors: [],
      emit(list) {
        const n = Math.min(list.length, N);
        const arr = new Float32Array(n * STRIDE);
        for (let i = 0; i < n; i++) {
          const p = list[i], o = i * STRIDE;
          arr[o] = p.x; arr[o + 1] = p.y; arr[o + 2] = p.vx || 0; arr[o + 3] = p.vy || 0;
          arr[o + 4] = p.r; arr[o + 5] = p.g; arr[o + 6] = p.b; arr[o + 7] = p.life;
          arr[o + 8] = p.size || 6; arr[o + 9] = p.life; arr[o + 10] = p.seed ?? Math.random(); arr[o + 11] = p.shape || 0;
        }
        let off = 0;
        while (off < n) {
          const m = Math.min(n - off, N - cursor);
          device.queue.writeBuffer(pbuf, cursor * STRIDE * 4, arr.subarray(off * STRIDE, (off + m) * STRIDE));
          cursor = (cursor + m) % N; off += m;
        }
      },
      start(onFrame) {
        let last = performance.now();
        const loop = (now) => {
          const dt = Math.min(0.05, (now - last) / 1000); last = now;
          if (onFrame) onFrame(dt, now / 1000);
          const P = sys.params, A = sys.attractors.slice(0, MAXA);
          u[0] = innerWidth; u[1] = innerHeight; u[2] = dt; u[3] = now / 1000;
          u[4] = P.grav[0]; u[5] = P.grav[1]; u[6] = P.drag; u[7] = A.length;
          u[8] = P.wind[0]; u[9] = P.wind[1]; u[10] = P.turb; u[11] = P.glow;
          A.forEach((a, i) => { u[12 + i * 4] = a.x; u[13 + i * 4] = a.y; u[14 + i * 4] = a.s || 0; u[15 + i * 4] = a.swirl || 0; });
          device.queue.writeBuffer(ubuf, 0, u);
          const enc = device.createCommandEncoder();
          const c = enc.beginComputePass(); c.setPipeline(sim); c.setBindGroup(0, simBG); c.dispatchWorkgroups(Math.ceil(N / 64)); c.end();
          const r = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] });
          r.setPipeline(draw); r.setBindGroup(0, drawBG); r.draw(6, N); r.end();
          device.queue.submit([enc.finish()]);
          requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      },
    };
    return sys;
  }
  // いろ（hue 0〜1）→ [r,g,b]
  function hsv(h, s = 1, v = 1) {
    const f = (n) => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return [f(5), f(3), f(1)];
  }
  return { create, hsv };
})();
