/**
 * ZhuyeEmblem —— 「烛夜 · 焰羽生花」动态像素徽记（纯 Canvas 实时渲染，无图片 / SVG 素材）。
 *
 * 移植自设计稿 zhunye_pixel_animated_v5.html：造型（emblemArtwork.ts 的
 * 8 个语义分组）逐组渲染进离屏画布，每帧按枢轴做微旋转 / 平移 / 缩放
 * 合成 —— 光环呼吸、焰羽轻摆、鸡首轻点、火芯跃动、花瓣开合；焰心内
 * 半透明金色流焰，embers 层有十字星光、沿金弧巡游的高光、带尾迹的
 * 上升火星与花芯热尘。动效幅度固定在**柔和档**（三档：柔和 .45 /
 * 灵动 1 / 炽烈 1.65）。四层画布：emblem / soft·bloom 双层辉光复制
 * （CSS 模糊 + halo-pulse·soft-glow 呼吸）/ embers 粒子。40FPS 上限
 * 降功耗；页面隐藏即暂停；遵循 prefers-reduced-motion（静止一帧）；
 * jsdom 等无 2d 上下文环境跳过绘制，仅保留 DOM 结构。
 */
import { useEffect, useRef } from 'react';
import { DX, DY, WORLD, ensureShapes } from './emblemArtwork';
import s from '@/render/home/ChatHero.module.css';

/* 渲染分辨率（设计稿默认 186；取 224 与 112px 展示在 2x 屏整数对齐）。 */
const RES = 224;
/* 动效幅度：柔和档（设计稿 energyLabels 三档 ['柔和','灵动','炽烈'] = [.45,1,1.65]）。 */
const ENERGY = 0.45;
/* 分组离屏画布数量（造型 8 组）。 */
const GROUP_COUNT = 8;
const TAU = Math.PI * 2;

/* 十字星光：世界坐标 + 相位（与徽记同一坐标系）。 */
const STARS = [
  { x: 622, y: 238, r: 6, phase: 0.8 }, { x: 581, y: 289, r: 3, phase: 2.6 },
  { x: 1017, y: 350, r: 7, phase: 4.1 }, { x: 975, y: 395, r: 3, phase: 0.1 },
  { x: 522, y: 427, r: 3, phase: 3.8 }, { x: 591, y: 220, r: 1, phase: 2.3 },
];

/* 确定性伪随机（sin 哈希），与设计稿一致。 */
const rnd = (i: number) => {
  const n = Math.sin(i * 127.1 + 78.23) * 43758.5453;
  return n - Math.floor(n);
};

/* 上升火星：44 颗，带摆动 / 尾迹 / 三色温分布。 */
const EMBERS = Array.from({ length: 44 }, (_, i) => ({
  x: 618 + rnd(i + 9) * 360,
  phase: rnd(i + 35),
  speed: 0.75 + rnd(i + 68) * 0.7,
  wobble: 9 + rnd(i + 101) * 28,
  side: (rnd(i + 127) - 0.5) * 90,
  size: 1.2 + rnd(i + 181) * 3.8,
  hue: rnd(i + 225),
  spin: rnd(i + 315) * TAU,
}));

/* 花芯热尘：9 缕，自花心升起融入金身。 */
const WISPS = Array.from({ length: 9 }, (_, i) => ({ phase: rnd(i + 410), x: 690 + rnd(i + 455) * 175 }));

/* 分组离屏画布：每组一个 RES×RES 图层，只在首次绘制时构建并模块级缓存。 */
let cachedSources: HTMLCanvasElement[] | null = null;

function ensureSources(): HTMLCanvasElement[] {
  if (cachedSources) return cachedSources;
  const sources: HTMLCanvasElement[] = [];
  const shapes = ensureShapes();
  for (let j = 0; j < GROUP_COUNT; j++) {
    const layer = document.createElement('canvas');
    layer.width = RES;
    layer.height = RES;
    const ctx = layer.getContext('2d', { alpha: true });
    if (!ctx) continue; // 无 2d 上下文环境（jsdom）：由调用方守卫
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    ctx.scale(RES / WORLD, RES / WORLD);
    ctx.translate(DX, DY);
    for (const sh of shapes) {
      if (sh.group !== j) continue;
      const grad = ctx.createLinearGradient(sh.x1, sh.y1, sh.x2, sh.y2);
      for (const [stop, color] of sh.stops) grad.addColorStop(stop, color);
      if (sh.stroke) {
        ctx.strokeStyle = sh.stroke;
        ctx.lineWidth = sh.lw;
        ctx.stroke(sh.p);
      }
      ctx.fillStyle = grad;
      ctx.fill(sh.p);
    }
    ctx.restore();
    sources.push(layer);
  }
  cachedSources = sources;
  return sources;
}

/* 把第 j 组图层绕世界坐标枢轴做微旋转 / 平移 / 缩放后合成到目标画布。 */
function composite(ctx: CanvasRenderingContext2D, sources: HTMLCanvasElement[], j: number,
  rot = 0, tx = 0, ty = 0, sx = 1, sy = 1, pivotX = 768, pivotY = 750) {
  const scale = RES / WORLD;
  const px = (pivotX + DX) * scale;
  const py = pivotY * scale;
  ctx.save();
  ctx.translate(px + tx * scale, py + ty * scale);
  ctx.rotate(rot);
  ctx.scale(sx, sy);
  ctx.translate(-px, -py);
  ctx.drawImage(sources[j], 0, 0);
  ctx.restore();
}

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number,
  color: string, alpha = 1) {
  const s = RES / WORLD;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(Math.round((x + DX) * s), Math.round(y * s), Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)));
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number) {
  const S = RES / WORLD;
  const X = Math.round((x + DX) * S);
  const Y = Math.round(y * S);
  const R = Math.max(1, Math.round(r * S));
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#ffb829';
  ctx.fillRect(X - 2 * R, Y, 4 * R + 1, R);
  ctx.fillStyle = '#ffd03e';
  ctx.fillRect(X, Y - 2 * R, R, 4 * R + 1);
  ctx.fillStyle = '#fff9ba';
  ctx.fillRect(X, Y, R, R);
}

/* 焰心内半透明金色流焰：限制在雄鸡亮色主体内 + 烛心小火舌舞动。 */
function wavyFlames(ctx: CanvasRenderingContext2D, t: number) {
  const p = ENERGY;
  ctx.save();
  ctx.scale(RES / WORLD, RES / WORLD);
  ctx.translate(DX, DY);
  for (let i = 0; i < 3; i++) {
    const phase = t * (1.28 + i * 0.24) + i * 2.1;
    const dx = Math.sin(phase) * 4 * p;
    const dy = Math.cos(phase * 0.78) * 5 * p;
    ctx.beginPath();
    ctx.moveTo(757 + i * 12 + dx, 680 - dy);
    ctx.bezierCurveTo(733 + i * 13 + dx, 604, 769 + i * 14 - dx, 541 + dy, 805 + i * 19 + dx, 496);
    ctx.bezierCurveTo(829 + i * 12 + dx, 458, 856 + dx, 419 + dy, 869 + i * 3, 393);
    ctx.lineWidth = i === 0 ? 10 : 5;
    ctx.strokeStyle = i === 0 ? '#ffeb6d' : i === 1 ? '#fff5ac' : '#ffc62c';
    ctx.globalAlpha = (0.07 + 0.035 * Math.sin(phase * 2)) * (0.7 + 0.3 * p);
    ctx.stroke();
  }
  const x = 767 + 3 * Math.sin(t * 2.2) * p;
  ctx.globalAlpha = 0.18 + 0.11 * Math.sin(t * 4.1) ** 2;
  ctx.fillStyle = '#fffbd0';
  ctx.beginPath();
  ctx.moveTo(x, 650);
  ctx.bezierCurveTo(x - 15, 624, x + 8, 602, x - 3, 588);
  ctx.bezierCurveTo(x + 17, 617, x + 12, 631, x, 650);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();
}

/* embers 层：星光闪烁 + 沿金弧巡游高光 + 带尾迹上升火星 + 花芯热尘。 */
function drawEmbers(ctx: CanvasRenderingContext2D, t: number) {
  ctx.clearRect(0, 0, RES, RES);
  ctx.imageSmoothingEnabled = false;
  for (const st of STARS) {
    star(ctx, st.x, st.y, st.r, 0.42 + 0.31 * Math.sin(t * 1.3 + st.phase) ** 2);
  }
  // 暖色高光沿既有金弧曲线巡游（不改变弧的剪影）。
  const h = (t * 0.09) % 1;
  const theta = -3.05 + 2.72 * h;
  const hx = 746 + 288 * Math.cos(theta);
  const hy = 364 + 281 * Math.sin(theta);
  const glint = Math.sin(Math.PI * h) ** 1.5;
  if (glint > 0.05) {
    star(ctx, hx, hy, 4, glint * 0.75);
    rect(ctx, hx - 8, hy - 1, 15, 2, '#fff2a1', glint * 0.46);
  }
  for (let i = 0; i < EMBERS.length; i++) {
    const e = EMBERS[i];
    const life = (t * e.speed / 5.7 + e.phase) % 1;
    const xx = e.x + Math.sin(t * 0.85 + e.spin + life * 7) * e.wobble * ENERGY + e.side * life;
    const yy = 741 - life * 670 + Math.sin(t * 1.7 + e.spin) * 5;
    const fade = Math.min(1, life / 0.1, (1 - life) / 0.26);
    const flicker = 0.66 + 0.34 * Math.sin(t * 3.8 + e.spin + life * 9) ** 2;
    const alpha = Math.max(0, fade) * flicker * (0.46 + 0.45 * ENERGY);
    const color = e.hue > 0.83 ? '#fff3a3' : e.hue > 0.45 ? '#ffc13e' : '#ff671a';
    if (alpha < 0.02) continue;
    const size = Math.max(2, e.size * (e.hue > 0.94 ? 1.5 : 1));
    rect(ctx, xx, yy, size, size, color, alpha);
    // 短尾迹让上升漂移有方向感。
    if (i % 3 === 0) {
      rect(ctx, xx + 1, yy + size * 2.5, size * 0.78, size * 0.78, '#f7520e', alpha * 0.48);
      rect(ctx, xx + 2, yy + size * 5, size * 0.55, size * 0.55, '#9c1f0b', alpha * 0.24);
    }
    if (i % 13 === 0 && life > 0.3 && life < 0.7) star(ctx, xx, yy, 2.6, alpha * 0.68);
  }
  // 花芯升起的热尘，渐隐进金色身体。
  for (let i = 0; i < WISPS.length; i++) {
    const wsp = WISPS[i];
    const life = (t * 0.25 + wsp.phase) % 1;
    const x = wsp.x + Math.sin(life * 8 + i) * 12 * ENERGY;
    const y = 673 - life * 410;
    rect(ctx, x, y, 2.5, 2.5, i % 3 ? '#ffac26' : '#ffe772', Math.sin(Math.PI * life) * 0.35);
  }
  ctx.globalAlpha = 1;
}

/* 每帧合成：光环呼吸、焰羽轻摆、鸡首轻点、花瓣微开合、火芯跃动。 */
function draw(ctx: CanvasRenderingContext2D, sources: HTMLCanvasElement[], t: number) {
  ctx.clearRect(0, 0, RES, RES);
  ctx.imageSmoothingEnabled = false;
  const e = ENERGY;
  const slow = Math.sin(t * 1.35);
  const pulse = Math.sin(t * 2.45);
  const wing = Math.sin(t * 1.05 + 0.8);
  composite(ctx, sources, 0, 0.0016 * slow * e, 0, 0, 1 + 0.0015 * slow * e, 1 + 0.0015 * slow * e, 750, 357);
  composite(ctx, sources, 1, -0.0045 * wing * e, Math.sin(t * 0.83) * 2 * e, Math.cos(t * 0.97) * 2 * e, 1, 1, 823, 426);
  composite(ctx, sources, 2, 0.0026 * slow * e, Math.sin(t * 1.15) * 2.3 * e, -pulse * 1.7 * e, 1 + 0.003 * slow * e, 1 + 0.007 * pulse * e, 768, 685);
  composite(ctx, sources, 3, 0.0027 * Math.sin(t * 0.93 + 0.5) * e, Math.sin(t * 1.3) * 1.2 * e, Math.sin(t * 0.8) * 1.4 * e, 1, 1, 865, 352);
  // 花瓣开合保持克制，不做卡通式张合。
  composite(ctx, sources, 4, 0, 0, 0, 1 + 0.004 * Math.sin(t * 0.91) * e, 1 - 0.002 * slow * e, 768, 781);
  composite(ctx, sources, 5, 0.0021 * Math.sin(t * 2.2) * e, 0, -2 * pulse * e, 1 + 0.009 * Math.sin(t * 2) * e, 1 + 0.021 * Math.sin(t * 2.35) * e, 767, 708);
  if (e > 0.1) wavyFlames(ctx, t);
  composite(ctx, sources, 6, 0, 0, 0, 1 + 0.003 * Math.sin(t * 0.91 + 0.5) * e, 1, 768, 780);
  composite(ctx, sources, 7, 0, 0, 0, 1, 1 + 0.002 * slow * e, 766, 850);
}

export function ZhuyeEmblem() {
  const emblemRef = useRef<HTMLCanvasElement | null>(null);
  const softRef = useRef<HTMLCanvasElement | null>(null);
  const bloomRef = useRef<HTMLCanvasElement | null>(null);
  const embersRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const emblemCv = emblemRef.current;
    const softCv = softRef.current;
    const bloomCv = bloomRef.current;
    const embersCv = embersRef.current;
    const base = emblemCv?.getContext('2d');
    const soft = softCv?.getContext('2d');
    const bloom = bloomCv?.getContext('2d');
    const emberCtx = embersCv?.getContext('2d');
    if (!emblemCv || !softCv || !bloomCv || !embersCv || !base || !soft || !bloom || !emberCtx) {
      return; // jsdom 无 2d 上下文：跳过绘制
    }
    for (const ctx of [base, soft, bloom, emberCtx]) ctx.imageSmoothingEnabled = false;
    const sources = ensureSources();
    if (sources.length !== GROUP_COUNT) return;
    // 首帧静态合成（减弱动态偏好下即为最终静止画面），随后复制作辉光底。
    draw(base, sources, 0);
    drawEmbers(emberCtx, 0);
    for (const g of [soft, bloom]) {
      g.clearRect(0, 0, RES, RES);
      g.drawImage(emblemCv, 0, 0);
    }

    // 40FPS 上限：保留像素锐度同时降低功耗；页面隐藏即暂停。
    let raf = 0;
    let lastPaint = -1;
    let elapsed = 0;
    let startAt: number | null = null;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let moving = !reduced.matches;
    const tick = (now: number) => {
      if (!moving) return;
      if (startAt === null) startAt = now;
      if (now - lastPaint >= 25) {
        elapsed += (Math.min(70, now - lastPaint) * 0.001) * (lastPaint < 0 ? 0 : 1);
        draw(base, sources, elapsed);
        drawEmbers(emberCtx, elapsed);
        lastPaint = now;
      }
      raf = requestAnimationFrame(tick);
    };
    const start = () => {
      if (moving && !document.hidden) {
        startAt = null;
        lastPaint = -1;
        raf = requestAnimationFrame(tick);
      }
    };
    const halt = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const onVisibility = () => {
      if (document.hidden) halt();
      else if (moving) start();
    };
    const onReducedChange = (ev: MediaQueryListEvent) => {
      moving = !ev.matches;
      halt();
      if (moving) start();
    };
    document.addEventListener('visibilitychange', onVisibility);
    reduced.addEventListener('change', onReducedChange);
    if (moving) start();
    return () => {
      halt();
      document.removeEventListener('visibilitychange', onVisibility);
      reduced.removeEventListener('change', onReducedChange);
    };
  }, []);

  return (
    <div className={s.emblem} data-testid="chat-hero-emblem" aria-hidden="true">
      <canvas ref={bloomRef} width={RES} height={RES} className={s.emblemBloom} />
      <canvas ref={softRef} width={RES} height={RES} className={s.emblemSoft} />
      <canvas ref={emblemRef} width={RES} height={RES} className={s.emblemCanvas} />
      <canvas ref={embersRef} width={RES} height={RES} className={s.emblemEmbers} />
    </div>
  );
}
