import { getBackground, resolveParams } from './backgrounds';
import { placement } from './layout';
import { buildGrainTiles, drawOverlays } from './overlays';
import { buildPaperCanvas, buildShadowSprite, buildSleeveCanvas, roundRectPath, sleeveRadius } from './sleeve';
import { TAU, frameState, getTiming, type FrameRef, type Timing } from './timing';
import type { AnyCanvas, CanvasFactory, Ctx2D, ImageLike, SceneAssets, SceneConfig, Sprite } from './types';
import { buildDiscCanvas, drawSheen } from './vinyl';

export function timingFor(cfg: SceneConfig): Timing {
  return getTiming({
    fps: cfg.fps,
    rpm: cfg.rpm,
    targetLoopSeconds: cfg.targetLoopSeconds,
    introSeconds: cfg.introEnabled ? cfg.introSeconds : 0,
    outroSeconds: cfg.outroEnabled ? cfg.outroSeconds : 0,
  });
}

export interface SceneImages {
  cover: ImageLike | null;
  /** Separate label image; falls back to the cover. */
  label: ImageLike | null;
}

/** Largest bitmap cache size for the disc; bigger outputs just upscale slightly. */
const MAX_DISC_CACHE = 2400;
/** Inner paper sleeve: size relative to the jacket and how far it peeks out of the opening. */
const PAPER_SCALE = 0.97;
const PAPER_PEEK = 0.045;

let grainCache: { factory: CanvasFactory; tiles: AnyCanvas[] } | null = null;

/** Pre-renders everything static for an output of W×H. Call again when the size or looks change. */
export function buildAssets(
  cfg: SceneConfig,
  images: SceneImages,
  W: number,
  H: number,
  factory: CanvasFactory,
): SceneAssets {
  const l = placement(cfg, W, H, 1);
  const labelImg = cfg.useSeparateLabel && images.label ? images.label : images.cover;
  const labelCrop = cfg.useSeparateLabel && images.label ? cfg.labelCrop : cfg.coverCrop;
  const disc = buildDiscCanvas(factory, {
    size: Math.min(MAX_DISC_CACHE, Math.ceil(l.D)),
    label: labelImg,
    labelCrop,
    labelSize: cfg.vinyl.labelSize,
    style: cfg.vinyl.style,
    color: cfg.vinyl.color,
  });
  const sleeve = buildSleeveCanvas(factory, {
    size: Math.ceil(l.S),
    cover: images.cover,
    crop: cfg.coverCrop,
    direction: cfg.direction,
    wear: cfg.sleeve.wear,
  });
  const paper = cfg.sleeve.innerSleeve ? buildPaperCanvas(factory, l.S * PAPER_SCALE) : null;
  const blur = Math.min(W, H) * 0.035;
  const sleeveShadow = buildShadowSprite(factory, l.S, l.S, blur, (ctx, x, y, w, h) => {
    roundRectPath(ctx, x, y, w, h, sleeveRadius(w));
    ctx.fill();
  });
  const discShadow = buildShadowSprite(factory, l.D, l.D, blur, (ctx, x, y, w) => {
    ctx.beginPath();
    ctx.arc(x + w / 2, y + w / 2, w / 2, 0, Math.PI * 2);
    ctx.fill();
  });
  if (!grainCache || grainCache.factory !== factory) grainCache = { factory, tiles: buildGrainTiles(factory) };
  return { width: W, height: H, disc, sleeve, paper, discShadow, sleeveShadow, grainTiles: grainCache.tiles };
}

function drawSprite(ctx: Ctx2D, s: Sprite, cx: number, cy: number, w: number, h: number): void {
  ctx.drawImage(s.canvas, cx - w / 2 - s.pad, cy - h / 2 - s.pad, w + s.pad * 2, h + s.pad * 2);
}

/**
 * Pure, deterministic frame renderer. The same frame always produces the same pixels.
 * `frame` is a timeline number ([0, I) intro, [I, ∞) loop) or a FrameRef (needed for the outro).
 */
export function renderFrame(ctx: Ctx2D, frame: number | FrameRef, cfg: SceneConfig, assets: SceneAssets): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const t = timingFor(cfg);
  const st = frameState(t, frame);
  const l = placement(cfg, W, H, st.move);
  const shadowY = Math.min(W, H) * 0.012;
  const shadowAlpha = Math.min(1, Math.max(0, cfg.shadow)) * 0.75;
  const bg = getBackground(cfg.background.id);
  const sleeveVisible = l.sleeveAlpha > 0.001;

  // Warped-record wobble: once per turn (N cycles per loop → periodic), eased in with the intro.
  const w = cfg.vinyl.wobble * Math.min(1, st.move * 1.5);
  const wob = TAU * t.N * st.phase;
  const squash = 1 - w * 0.035 * (0.5 - 0.5 * Math.cos(wob));
  const bob = w * 0.006 * l.D * Math.sin(wob);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, W, H);

  // 1. Background
  bg.draw(ctx, st.phase, W, H, cfg.background.palette, resolveParams(bg, cfg.background.params));

  // 2. Shadows of the group
  if (shadowAlpha > 0) {
    if (sleeveVisible) {
      ctx.globalAlpha = shadowAlpha * l.sleeveAlpha;
      drawSprite(ctx, assets.sleeveShadow, l.sleeveX, l.sleeveY + shadowY, l.S, l.S);
    }
    ctx.globalAlpha = shadowAlpha;
    ctx.save();
    if (sleeveVisible && !l.discFront) {
      // Disc shadow only where the sleeve doesn't cover it (avoids double darkening).
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.rect(l.sleeveX - l.S / 2, l.sleeveY - l.S / 2, l.S, l.S);
      ctx.clip('evenodd');
    }
    drawSprite(ctx, assets.discShadow, l.discX, l.discY + bob + shadowY, l.D, l.D * squash);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  const drawDisc = () => {
    ctx.save();
    ctx.translate(l.discX, l.discY + bob);
    ctx.scale(1, squash);
    ctx.save();
    ctx.rotate(st.angle);
    ctx.drawImage(assets.disc, -l.D / 2, -l.D / 2, l.D, l.D);
    ctx.restore();
    // The sheen follows the tilt a little, but never the rotation.
    drawSheen(ctx, 0, 0, l.D, cfg.vinyl.labelSize, cfg.vinyl.sheen, -Math.PI / 4 + w * 0.25 * Math.sin(wob));
    ctx.restore();
  };

  const drawSleeve = () => {
    if (!sleeveVisible) return;
    ctx.save();
    ctx.globalAlpha = l.sleeveAlpha;
    ctx.drawImage(assets.sleeve, l.sleeveX - l.S / 2, l.sleeveY - l.S / 2, l.S, l.S);
    ctx.restore();
  };

  const drawPaper = () => {
    if (!assets.paper || !sleeveVisible) return;
    const ps = l.S * PAPER_SCALE;
    const off = l.S / 2 - ps / 2 + l.S * PAPER_PEEK;
    ctx.save();
    ctx.globalAlpha = l.sleeveAlpha;
    ctx.translate(l.sleeveX + l.dx * off, l.sleeveY + l.dy * off);
    ctx.rotate(0.012);
    ctx.drawImage(assets.paper, -ps / 2, -ps / 2, ps, ps);
    ctx.restore();
  };

  // 3–4. Disc and sleeve. The disc goes over the sleeve only once they no longer overlap.
  if (l.discFront) {
    drawPaper();
    drawSleeve();
    drawDisc();
  } else {
    drawPaper();
    drawDisc();
    // The sleeve casts a soft shadow onto the disc.
    if (shadowAlpha > 0 && sleeveVisible) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(l.discX, l.discY + bob, l.D / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.globalAlpha = shadowAlpha * 0.6 * l.sleeveAlpha;
      drawSprite(ctx, assets.sleeveShadow, l.sleeveX, l.sleeveY + shadowY * 0.5, l.S, l.S);
      ctx.restore();
    }
    drawSleeve();
  }

  // 5. Overlays
  drawOverlays(ctx, W, H, cfg, st.seed, assets.grainTiles, !!bg.transparent);

  ctx.restore();
}

export interface ExportPlan {
  intro: boolean;
  /** Number of loop repetitions (0 = none). */
  loops: number;
  outro: boolean;
}

/** Frames to export, in order. The duplicated frame F is never included. */
export function framesFor(t: Timing, plan: ExportPlan): FrameRef[] {
  const out: FrameRef[] = [];
  if (plan.intro) for (let j = 0; j < t.I; j++) out.push({ seg: 'intro', i: j });
  for (let r = 0; r < plan.loops; r++) for (let i = 0; i < t.F; i++) out.push({ seg: 'loop', i });
  if (plan.outro) for (let k = 0; k < t.O; k++) out.push({ seg: 'outro', i: k });
  return out;
}

/** e.g. "intro-loopx3-outro" */
export function planTag(plan: ExportPlan): string {
  const parts: string[] = [];
  if (plan.intro) parts.push('intro');
  if (plan.loops > 0) parts.push(plan.loops === 1 ? 'loop' : `loopx${plan.loops}`);
  if (plan.outro) parts.push('outro');
  return parts.join('-') || 'vacio';
}
