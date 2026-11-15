// のはらの けしき（WebGPU シェーダー）: そら・くも・やま・おか・くさはら・みち を かさねて ながす
// FieldScene.create(canvas) → { draw(t, dist, speed01, day, turbo) }
const FIELD_WGSL = /* wgsl */`
struct U { res: vec2f, time: f32, dist: f32, speed: f32, day: f32, dpr: f32, turbo: f32 };
@group(0) @binding(0) var<uniform> u: U;
@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(-1.0, 1.0), vec2f(3.0, 1.0));
  return vec4f(p[i], 0.0, 1.0);
}
fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn noise(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p); let w = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2f(1.0, 0.0)), w.x), mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0, 1.0)), w.x), w.y);
}
fn fbm(p0: vec2f) -> f32 {
  var p = p0; var v = 0.0; var a = 0.5;
  for (var i = 0; i < 5; i = i + 1) { v = v + a * noise(p); p = p * 2.02; a = a * 0.5; }
  return v;
}
fn hsv(h: f32, s: f32, v: f32) -> vec3f {
  let k = vec3f(1.0, 2.0 / 3.0, 1.0 / 3.0);
  let p = abs(fract(vec3f(h) + k) * 6.0 - 3.0);
  return v * mix(vec3f(1.0), clamp(p - 1.0, vec3f(0.0), vec3f(1.0)), s);
}
// あさ・ひる・ゆうがた・よる の いろを なめらかに つなぐ
fn pal(d: f32, a: vec3f, b: vec3f, c: vec3f, e: vec3f) -> vec3f {
  let t = fract(d) * 4.0;
  let k = smoothstep(0.0, 1.0, fract(t));
  if (t < 1.0) { return mix(a, b, k); }
  if (t < 2.0) { return mix(b, c, k); }
  if (t < 3.0) { return mix(c, e, k); }
  return mix(e, a, k);
}
@fragment
fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let p = fc.xy / u.dpr;
  let W = u.res.x / u.dpr; let H = u.res.y / u.dpr;
  let gy = H * 0.64;
  let night = smoothstep(0.55, 0.7, fract(u.day)) * (1.0 - smoothstep(0.88, 1.0, fract(u.day)));
  // そら
  let top = pal(u.day, vec3f(0.45, 0.7, 1.0), vec3f(0.3, 0.6, 1.0), vec3f(0.35, 0.25, 0.6), vec3f(0.03, 0.04, 0.15));
  let hor = pal(u.day, vec3f(1.0, 0.85, 0.75), vec3f(0.75, 0.9, 1.0), vec3f(1.0, 0.55, 0.3), vec3f(0.12, 0.1, 0.3));
  var col = mix(top, hor, pow(clamp(p.y / gy, 0.0, 1.0), 1.4));
  // ほし（よる）
  let st = hash(floor(p / 3.0));
  if (st > 0.995 && p.y < gy) { col = col + vec3f(0.9) * night * (0.6 + 0.4 * sin(u.time * 3.0 + st * 80.0)); }
  // おひさま / おつきさま
  let sunPos = vec2f(W * 0.78, H * (0.12 + 0.25 * night));
  let sd = distance(p, sunPos);
  let sunCol = mix(vec3f(1.0, 0.92, 0.6), vec3f(0.95, 0.95, 1.0), night);
  col = col + sunCol * (smoothstep(46.0, 42.0, sd) + exp(-sd / 90.0) * 0.45);
  // くも
  let cl = fbm(vec2f((p.x + u.dist * 0.04) * 0.004, p.y * 0.012 + 3.0));
  let band = smoothstep(gy * 0.75, gy * 0.1, p.y);
  col = mix(col, mix(vec3f(1.0), hor, 0.3) * (1.0 - night * 0.6), smoothstep(0.55, 0.75, cl) * band * 0.85);
  // スピードの ひかり（そらに よこの すじ）
  let sk = noise(vec2f(p.y * 0.25, (p.x + u.time * 2500.0) * 0.0015));
  col = col + vec3f(1.0) * smoothstep(0.8, 1.0, sk) * smoothstep(0.4, 1.0, u.speed) * 0.25 * band;
  // とおくの やま
  let m1 = gy - 70.0 - 170.0 * fbm(vec2f((p.x + u.dist * 0.07) * 0.0025, 1.3));
  if (p.y > m1) {
    var mc = mix(vec3f(0.45, 0.55, 0.8), hor, 0.45) * (1.0 - night * 0.7);
    if (p.y < m1 + 18.0 && m1 < gy - 170.0) { mc = mix(mc, vec3f(1.0), 0.7 * (1.0 - night * 0.6)); } // ゆき
    col = mc;
  }
  // てまえの おか
  let m2 = gy - 25.0 - 70.0 * fbm(vec2f((p.x + u.dist * 0.3) * 0.005, 7.1));
  if (p.y > m2) { col = mix(vec3f(0.35, 0.7, 0.35), hor * 0.4, 0.15) * (1.0 - night * 0.65) * (0.9 + 0.1 * noise(p * 0.05)); }
  // じめん（くさはら と みち）
  if (p.y > gy) {
    let dy = p.y - gy;
    let stripe = step(0.5, fract((p.x + u.dist) / 90.0 - dy * 0.006));
    var gc = mix(vec3f(0.42, 0.78, 0.36), vec3f(0.36, 0.7, 0.3), stripe);
    let road = smoothstep(18.0, 22.0, dy) * (1.0 - smoothstep(78.0, 82.0, dy));
    let pebble = noise(vec2f((p.x + u.dist) * 0.08, dy * 0.08));
    gc = mix(gc, vec3f(0.85, 0.7, 0.5) * (0.9 + 0.15 * pebble), road);
    col = gc * (1.0 - night * 0.6);
  }
  // ターボ: がめんの ふちが にじいろに ひかる
  let e = max(abs(p.x / W - 0.5), abs(p.y / H - 0.5)) * 2.0;
  col = col + hsv(fract(u.time * 0.8 + p.y / H * 0.5), 0.8, 1.0) * smoothstep(0.75, 1.0, e) * u.turbo * 0.8;
  return vec4f(col, 1.0);
}`;
const FieldScene = {
  async create(canvas) {
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    const ctx = canvas.getContext('webgpu'), format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format, alphaMode: 'opaque' });
    const mod = device.createShaderModule({ code: FIELD_WGSL });
    const pipe = device.createRenderPipeline({ layout: 'auto', vertex: { module: mod, entryPoint: 'vs' }, fragment: { module: mod, entryPoint: 'fs', targets: [{ format }] } });
    const ubuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const bg = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubuf } }] });
    let dpr = fitCanvas(canvas);
    addEventListener('resize', () => { dpr = fitCanvas(canvas); });
    return {
      draw(t, dist, speed01, day, turbo) {
        device.queue.writeBuffer(ubuf, 0, new Float32Array([canvas.width, canvas.height, t, dist % 400000, speed01, day, dpr, turbo]));
        const enc = device.createCommandEncoder();
        const p = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' }] });
        p.setPipeline(pipe); p.setBindGroup(0, bg); p.draw(3); p.end();
        device.queue.submit([enc.finish()]);
      },
    };
  },
};
