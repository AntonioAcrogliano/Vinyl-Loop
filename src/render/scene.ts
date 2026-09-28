import { getBackground, resolveParams } from './backgrounds';
import { DISC_TO_SLEEVE, placement, type Placement } from './layout';
import { drawLyricsList, isPortrait, lyricBlocks, openAmount, openDuration, slideRegion } from './lyrics';
import { buildGrainTiles, drawOverlays } from './overlays';
import { rpmText } from './labels';
import {
  buildPaperCanvas,
  buildShadowSprite,
  buildSleeveBackCanvas,
  buildSleeveCanvas,
  holeRadiusFor,
  roundRectPath,
  sleeveRadius,
} from './sleeve';
import { drawTitleCard } from './text';
import { TAU, clamp01, easeInOutCubic, frameState, getTiming, toFrameRef, type FrameRef, type Timing } from './timing';
import type { AnyCanvas, CanvasFactory, Ctx2D, ImageLike, SceneAssets, SceneConfig, Sprite } from './types';
import { buildDiscCanvas, drawSheen, type LabelArt } from './vinyl';
import type { LyricLine } from '../lyrics/lyrics';

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
  /** Separate label image (label.source = 'image'). */
  label: ImageLike | null;
}

/**
 * What goes on the label. A photo source without a photo falls back to the standard design,
 * so the app looks finished before anything is uploaded.
 */
export function labelArtFor(cfg: SceneConfig, images: SceneImages): LabelArt {
  const src = cfg.label.source;
  // The label has its own crop even when it uses the cover photo (e.g. to center a face).
  if (src === 'cover' && images.cover) return { kind: 'image', image: images.cover, crop: cfg.labelCrop };
  if (src === 'image' && images.label) return { kind: 'image', image: images.label, crop: cfg.labelCrop };
  return {
    kind: 'preset',
    preset: cfg.label.preset,
    color: cfg.label.color,
    texts: { title: cfg.label.title, subtitle: cfg.label.subtitle, rpm: rpmText(cfg.rpm) },
  };
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
  const disc = buildDiscCanvas(factory, {
    size: Math.min(MAX_DISC_CACHE, Math.ceil(l.D)),
    label: labelArtFor(cfg, images),
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
    style: cfg.sleeve.style,
    material: cfg.sleeve.material,
    color: cfg.sleeve.color,
    holeRadius: holeRadiusFor(cfg.vinyl.labelSize),
  });
  const sleeveBack =
    cfg.sleeve.style === 'dieCut' ? buildSleeveBackCanvas(factory, l.S, cfg.sleeve.material, cfg.sleeve.color) : null;
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
  return { width: W, height: H, disc, sleeve, sleeveBack, paper, discShadow, sleeveShadow, grainTiles: grainCache.tiles };
}

function drawSprite(ctx: Ctx2D, s: Sprite, cx: number, cy: number, w: number, h: number): void {
  // The blur margin scales with the shape, so a shrunken group keeps a proportional shadow.
  const px = s.pad * (w / Math.max(1, s.canvas.width - s.pad * 2));
  const py = s.pad * (h / Math.max(1, s.canvas.height - s.pad * 2));
  ctx.drawImage(s.canvas, cx - w / 2 - px, cy - h / 2 - py, w + px * 2, h + py * 2);
}

export interface SongContext {
  /** Clean, sorted lyric lines (see cleanLines). */
  lines: LyricLine[];
  /** The full-song plan the frames belong to (maps frames to song time). */
  plan: ExportPlan;
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

/** Gatefold spread: two panels around a central spine (side by side, or stacked in portrait). */
function gatefoldGeometry(W: number, H: number) {
  const portrait = isPortrait(W, H);
  const P = portrait ? Math.min(W * 0.82, H * 0.44) : Math.min(W * 0.44, H * 0.8);
  const ax = portrait ? 0 : 1;
  const ay = portrait ? 1 : 0;
  return {
    P,
    ax,
    ay,
    /** Panel where the lyrics are printed (right / bottom). */
    lyrics: { x: W / 2 + (ax * P) / 2, y: H / 2 + (ay * P) / 2 },
    /** Panel where the disc lies once open (left / top). */
    disc: { x: W / 2 - (ax * P) / 2, y: H / 2 - (ay * P) / 2 },
  };
}

/**
 * Pure, deterministic frame renderer. The same frame always produces the same pixels.
 * `frame` is a timeline number ([0, I) intro, [I, ∞) loop) or a FrameRef (needed for the outro).
 * `song` adds the karaoke lyrics of the full-song video; without it the loop is untouched.
 */
export function renderFrame(
  ctx: Ctx2D,
  frame: number | FrameRef,
  cfg: SceneConfig,
  assets: SceneAssets,
  song?: SongContext | null,
): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const t = timingFor(cfg);
  const ref = toFrameRef(t, frame);
  const st = frameState(t, ref);
  const shadowY = Math.min(W, H) * 0.012;
  const shadowAlpha = Math.min(1, Math.max(0, cfg.shadow)) * 0.75;
  const bg = getBackground(cfg.background.id);

  // Karaoke: how open the layout is at this point of the song (0 outside the lyrics).
  let songT = 0;
  let open = 0;
  let ramp = 0;
  if (song && cfg.lyrics.enabled && song.lines.length) {
    songT = songTimeOf(t, song.plan, ref);
    const lo = t.I / t.fps;
    const hi = (t.I + song.plan.loops * t.F) / t.fps;
    ramp = openAmount(lyricBlocks(song.lines, cfg), songT, lo, hi, openDuration(cfg), true);
    open = easeInOutCubic(ramp);
  }
  const gatefold = cfg.lyrics.open === 'gatefold';
  const base = placement(cfg, W, H, st.move, gatefold ? 0 : open);

  // Gatefold: phase A (first 40% of the ramp) the disc goes back in and the sleeve moves onto
  // the spread; phase B (the rest) the cover swings open, revealing the disc and the lyrics.
  // Each phase eases on its own, over the linear ramp.
  const ga = gatefold ? easeInOutCubic(clamp01(ramp / 0.4)) : 0;
  const gb = gatefold ? easeInOutCubic(clamp01((ramp - 0.4) / 0.6)) : 0;
  const spread = gatefold && open > 0 ? gatefoldGeometry(W, H) : null;
  let l = base;
  if (spread && ga > 0) {
    const sx = lerp(base.sleeveX, spread.lyrics.x, ga);
    const sy = lerp(base.sleeveY, spread.lyrics.y, ga);
    l = {
      ...base,
      sleeveX: sx,
      sleeveY: sy,
      S: lerp(base.S, spread.P, ga),
      D: lerp(base.D, spread.P * DISC_TO_SLEEVE, ga),
      discX: lerp(base.discX, sx, ga),
      discY: lerp(base.discY, sy, ga),
      sleeveAlpha: lerp(base.sleeveAlpha, 1, ga),
      discFront: base.discFront && ga < 0.5,
    };
  }

  // Warped-record wobble: once per turn (N cycles per loop → periodic), eased in with the intro.
  const w = cfg.vinyl.wobble * Math.min(1, st.move * 1.5) * (1 - ga);
  const wob = TAU * t.N * st.phase;
  const squash = 1 - w * 0.035 * (0.5 - 0.5 * Math.cos(wob));
  const sheenAngle = -Math.PI / 4 + w * 0.25 * Math.sin(wob);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, W, H);

  // 1. Background
  bg.draw(ctx, st.phase, W, H, cfg.background.palette, resolveParams(bg, cfg.background.params));

  // 2–4. The record
  if (spread && gb > 0) {
    drawOpenGatefold(ctx, W, H, cfg, assets, spread, gb, st.angle, song!.lines, songT, shadowAlpha, shadowY);
  } else {
    drawGroup(ctx, W, H, cfg, assets, l, st.angle, squash, w * 0.006 * l.D * Math.sin(wob), sheenAngle, shadowAlpha, shadowY);
  }

  // Lyrics beside the record (slide mode).
  if (!gatefold && open > 0) drawLyricsList(ctx, slideRegion(W, H).lyrics, song!.lines, songT, cfg, open, Math.min(W, H));

  // 5. Title card (steps aside for the lyrics), then overlays (grain and vignette affect the text too).
  drawTitleCard(ctx, W, H, cfg, st, t, 1 - open);
  drawOverlays(ctx, W, H, cfg, st.seed, assets.grainTiles, !!bg.transparent);

  ctx.restore();
}

/** Sleeve + disc with their shadows, as placed by `l`. */
function drawGroup(
  ctx: Ctx2D,
  W: number,
  H: number,
  cfg: SceneConfig,
  assets: SceneAssets,
  l: Placement,
  angle: number,
  squash: number,
  bob: number,
  sheenAngle: number,
  shadowAlpha: number,
  shadowY: number,
): void {
  const sleeveVisible = l.sleeveAlpha > 0.001;

  // Shadows of the group
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
    ctx.rotate(angle);
    ctx.drawImage(assets.disc, -l.D / 2, -l.D / 2, l.D, l.D);
    ctx.restore();
    // The sheen follows the tilt a little, but never the rotation.
    drawSheen(ctx, 0, 0, l.D, cfg.vinyl.labelSize, cfg.vinyl.sheen, sheenAngle);
    ctx.restore();
  };

  const holeR = holeRadiusFor(cfg.vinyl.labelSize) * l.S;

  // Inside of a die-cut sleeve, seen through the hole (behind the disc).
  const drawSleeveBack = () => {
    if (!assets.sleeveBack || !sleeveVisible) return;
    ctx.save();
    ctx.globalAlpha = l.sleeveAlpha;
    ctx.beginPath();
    ctx.arc(l.sleeveX, l.sleeveY, holeR + 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(assets.sleeveBack, l.sleeveX - l.S / 2, l.sleeveY - l.S / 2, l.S, l.S);
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

  // The disc goes over the sleeve only once they no longer overlap.
  if (l.discFront) {
    drawSleeveBack();
    drawPaper();
    drawSleeve();
    drawDisc();
  } else {
    drawSleeveBack();
    drawPaper();
    drawDisc();
    // The sleeve casts a soft shadow onto the disc.
    if (shadowAlpha > 0 && sleeveVisible) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(l.discX, l.discY + bob, l.D / 2, 0, Math.PI * 2);
      ctx.clip();
      if (assets.sleeveBack) {
        // Not through the die-cut hole: the label must stay visible there.
        ctx.beginPath();
        ctx.rect(0, 0, W, H);
        ctx.arc(l.sleeveX, l.sleeveY, holeR, 0, Math.PI * 2);
        ctx.clip('evenodd');
      }
      ctx.globalAlpha = shadowAlpha * 0.6 * l.sleeveAlpha;
      drawSprite(ctx, assets.sleeveShadow, l.sleeveX, l.sleeveY + shadowY * 0.5, l.S, l.S);
      ctx.restore();
    }
    drawSleeve();
  }
}

/** Inside paper of the gatefold (dark if the sleeve is black). */
function gatefoldPaper(cfg: SceneConfig): string {
  return cfg.sleeve.style === 'dieCut' && cfg.sleeve.material === 'black' ? '#232326' : '#f1ece2';
}

/**
 * Gatefold swinging open (b: 0 = closed on the lyrics panel, 1 = fully open). The cover
 * pivots on the spine: first it narrows over the lyrics panel (outside visible), then it
 * widens on the other side showing its inside, where the disc lies, still spinning.
 */
function drawOpenGatefold(
  ctx: Ctx2D,
  W: number,
  H: number,
  cfg: SceneConfig,
  assets: SceneAssets,
  g: ReturnType<typeof gatefoldGeometry>,
  b: number,
  angle: number,
  lines: LyricLine[],
  songT: number,
  shadowAlpha: number,
  shadowY: number,
): void {
  const { P, ax, ay } = g;
  const c = Math.cos(b * Math.PI);
  const paper = gatefoldPaper(cfg);
  const cx = W / 2;
  const cy = H / 2;

  // Shadows: the lyrics panel always, the disc panel as it opens.
  if (shadowAlpha > 0) {
    ctx.globalAlpha = shadowAlpha;
    drawSprite(ctx, assets.sleeveShadow, g.lyrics.x, g.lyrics.y + shadowY, P, P);
    if (c < 0) {
      const k = -c;
      const w = ax ? P * k : P;
      const h = ay ? P * k : P;
      drawSprite(ctx, assets.sleeveShadow, cx - (ax * w) / 2, cy - (ay * h) / 2 + shadowY, w, h);
    }
    ctx.globalAlpha = 1;
  }

  // Lyrics panel (inside of the back cover), with a soft fold shadow along the spine.
  const lx = g.lyrics.x - P / 2;
  const ly = g.lyrics.y - P / 2;
  ctx.fillStyle = paper;
  roundRectPath(ctx, lx, ly, P, P, sleeveRadius(P));
  ctx.fill();
  const fold = ax ? ctx.createLinearGradient(lx, 0, lx + P * 0.12, 0) : ctx.createLinearGradient(0, ly, 0, ly + P * 0.12);
  fold.addColorStop(0, 'rgba(0,0,0,0.16)');
  fold.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = fold;
  ctx.fillRect(lx, ly, P, P);
  const pad = P * 0.1;
  drawLyricsList(ctx, { x: lx + pad, y: ly + pad, w: P - pad * 2, h: P - pad * 2 }, lines, songT, cfg, 1, P * 1.15);

  // The swinging cover, drawn in spine-local coordinates scaled along the opening axis.
  ctx.save();
  ctx.translate(cx, cy);
  if (c > 0) {
    ctx.scale(ax ? c : 1, ay ? c : 1);
    const x0 = ax ? 0 : -P / 2;
    const y0 = ay ? 0 : -P / 2;
    ctx.drawImage(assets.sleeve, x0, y0, P, P);
    ctx.fillStyle = `rgba(0,0,0,${(0.45 * (1 - c)).toFixed(3)})`;
    ctx.fillRect(x0, y0, P, P);
  } else {
    const k = -c;
    ctx.scale(ax ? k : 1, ay ? k : 1);
    const x0 = ax ? -P : -P / 2;
    const y0 = ay ? -P : -P / 2;
    ctx.fillStyle = paper;
    roundRectPath(ctx, x0, y0, P, P, sleeveRadius(P));
    ctx.fill();
    const f2 = ax ? ctx.createLinearGradient(0, 0, -P * 0.12, 0) : ctx.createLinearGradient(0, 0, 0, -P * 0.12);
    f2.addColorStop(0, 'rgba(0,0,0,0.16)');
    f2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = f2;
    ctx.fillRect(x0, y0, P, P);
    // The disc lying on the inner panel, still spinning.
    const dcx = ax ? -P / 2 : 0;
    const dcy = ay ? -P / 2 : 0;
    const Dp = P * 0.86;
    ctx.save();
    ctx.translate(dcx, dcy);
    ctx.save();
    ctx.rotate(angle);
    ctx.drawImage(assets.disc, -Dp / 2, -Dp / 2, Dp, Dp);
    ctx.restore();
    drawSheen(ctx, 0, 0, Dp, cfg.vinyl.labelSize, cfg.vinyl.sheen);
    ctx.restore();
    ctx.fillStyle = `rgba(0,0,0,${(0.45 * (1 - k)).toFixed(3)})`;
    ctx.fillRect(x0, y0, P, P);
  }
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
  for (let r = 0; r < plan.loops; r++) for (let i = 0; i < t.F; i++) out.push({ seg: 'loop', i, rep: r });
  if (plan.outro) for (let k = 0; k < t.O; k++) out.push({ seg: 'outro', i: k });
  return out;
}

/**
 * Position of a frame in the song, in seconds. The song starts with the intro; a plan without
 * the intro starts at the loop (the audio is cut the same way on export).
 */
export function songTimeOf(t: Timing, plan: ExportPlan, ref: FrameRef): number {
  let idx: number;
  if (ref.seg === 'intro') idx = ref.i;
  else if (ref.seg === 'loop') idx = t.I + (ref.rep ?? 0) * t.F + ref.i;
  else idx = t.I + plan.loops * t.F + ref.i;
  return idx / t.fps;
}

/** e.g. "intro-loopx3-outro" */
export function planTag(plan: ExportPlan): string {
  const parts: string[] = [];
  if (plan.intro) parts.push('intro');
  if (plan.loops > 0) parts.push(plan.loops === 1 ? 'loop' : `loopx${plan.loops}`);
  if (plan.outro) parts.push('outro');
  return parts.join('-') || 'vacio';
}
