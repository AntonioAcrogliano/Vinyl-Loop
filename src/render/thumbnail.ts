import { DISC_TO_SLEEVE } from './layout';
import { buildAssets, renderFrame, type SceneImages } from './scene';
import type { AnyCanvas, CanvasFactory, Ctx2D, ImageLike, SceneConfig, TextFont, ThumbConfig } from './types';

// YouTube thumbnail: a still of the record plus a big, bold title. It reuses the scene
// renderer (so it matches the video) and adds its own layout and typography.

export const THUMB_W = 1280;
export const THUMB_H = 720;

export { DEFAULT_THUMB, type ThumbConfig } from './types';

const FAMILIES: Record<TextFont, { family: string; weight: string }> = {
  sans: { family: '"Arial Black", "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif', weight: '900' },
  serif: { family: 'Georgia, "Times New Roman", Times, serif', weight: '700' },
  condensed: { family: 'Impact, "Arial Narrow", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif', weight: '700' },
  mono: { family: '"Courier New", ui-monospace, Menlo, Consolas, monospace', weight: '700' },
};

export interface ThumbRegions {
  record: { x: number; y: number; w: number; h: number };
  text: { x: number; y: number; w: number; h: number };
}

export function thumbRegions(th: ThumbConfig, W: number, H: number): ThumbRegions {
  const m = W * 0.05;
  if (th.layout === 'left' || th.layout === 'right') {
    const tw = W * 0.44;
    const textX = th.layout === 'left' ? m : W - m - tw;
    const recX = th.layout === 'left' ? m + tw : 0;
    return {
      record: { x: recX, y: 0, w: W - tw - m, h: H },
      text: { x: textX, y: H * 0.1, w: tw, h: H * 0.8 },
    };
  }
  if (th.layout === 'bottom') {
    const th2 = H * 0.3;
    return {
      record: { x: 0, y: 0, w: W, h: H - th2 },
      text: { x: m, y: H - th2, w: W - 2 * m, h: th2 - H * 0.05 },
    };
  }
  return { record: { x: 0, y: 0, w: W, h: H }, text: { x: 0, y: 0, w: 0, h: 0 } };
}

/** The scene config that places the record in its region of a W×H thumbnail. */
export function thumbSceneConfig(cfg: SceneConfig, th: ThumbConfig, W: number, H: number): SceneConfig {
  const r = thumbRegions(th, W, H).record;
  // Size of the whole group (sleeve + protruding disc) relative to the sleeve side.
  const vertical = cfg.direction === 'up';
  const out = th.pose === 'out' ? cfg.discOut * DISC_TO_SLEEVE : 0;
  const fw = cfg.layout === 'solo' && th.pose === 'out' ? DISC_TO_SLEEVE : vertical ? 1 : 1 + out;
  const fh = cfg.layout === 'solo' && th.pose === 'out' ? DISC_TO_SLEEVE : vertical ? 1 + out : 1;
  const S = Math.min((0.9 * r.w) / fw, (0.86 * r.h) / fh) * th.recordSize;
  return {
    ...cfg,
    width: W,
    height: H,
    sleeveSize: S / Math.min(W, H),
    offsetX: (r.x + r.w / 2 - W / 2) / W,
    offsetY: (r.y + r.h / 2 - H / 2) / H,
    // The frame at index 0 is the start of the intro (disc inside), I the loop pose.
    introEnabled: true,
    introSeconds: Math.max(cfg.introSeconds, 0.5),
    text: { ...cfg.text, enabled: false },
    lyrics: { ...cfg.lyrics, enabled: false },
    vinyl: { ...cfg.vinyl, wobble: 0 },
    overlays: { ...cfg.overlays, grain: 0 },
    background: th.background === 'blur' ? { ...cfg.background, id: 'transparent' } : cfg.background,
  };
}

/** Cover-fit image, blurred by scaling down and back up in steps (works in every canvas). */
function drawBlurredPhoto(ctx: Ctx2D, img: ImageLike, W: number, H: number, factory: CanvasFactory): void {
  let w = 40;
  let h = Math.round((w * H) / W);
  let src: AnyCanvas = factory(w, h);
  const c0 = src.getContext('2d') as Ctx2D;
  const k = Math.max(w / img.width, h / img.height) * 1.15;
  c0.imageSmoothingQuality = 'high';
  c0.drawImage(img, (w - img.width * k) / 2, (h - img.height * k) / 2, img.width * k, img.height * k);
  while (w * 4 < W) {
    const next = factory(w * 4, h * 4);
    const c = next.getContext('2d') as Ctx2D;
    c.imageSmoothingQuality = 'high';
    c.drawImage(src, 0, 0, w * 4, h * 4);
    src = next;
    w *= 4;
    h *= 4;
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, W, H);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, W, H);
}

function wrap(ctx: Ctx2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && ctx.measureText(next).width > maxW) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

interface Block {
  lines: string[];
  size: number;
  font: string;
}

/** Largest font size (up to `max`) at which the text wraps into ≤ maxLines lines of ≤ maxW. */
function fitText(ctx: Ctx2D, text: string, fontOf: (s: number) => string, max: number, maxW: number, maxLines: number): Block {
  let size = max;
  for (;;) {
    const font = fontOf(size);
    ctx.font = font;
    const lines = wrap(ctx, text, maxW);
    const fits = lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= maxW);
    if (fits || size < 12) return { lines, size, font };
    size *= 0.94;
  }
}

function drawTextLine(ctx: Ctx2D, text: string, x: number, y: number, size: number, th: ThumbConfig): void {
  if (th.style === 'outline') {
    ctx.lineJoin = 'round';
    ctx.lineWidth = size * 0.16;
    ctx.strokeStyle = '#000';
    ctx.strokeText(text, x, y);
  }
  ctx.fillText(text, x, y);
}

function drawThumbText(ctx: Ctx2D, W: number, H: number, cfg: SceneConfig, th: ThumbConfig): void {
  const region = thumbRegions(th, W, H).text;
  const up = (s: string) => (th.uppercase ? s.toUpperCase() : s);
  const title = up((th.title || cfg.text.title).trim());
  const artist = up((th.artist || cfg.text.artist).trim());
  const tag = th.tag.trim().toUpperCase();
  if (!title && !artist && !tag) return;

  const f = FAMILIES[th.font] ?? FAMILIES.sans;
  const side = th.layout !== 'bottom';
  const align = side ? (th.layout === 'left' ? 'left' : 'right') : 'center';
  const x = align === 'left' ? region.x : align === 'right' ? region.x + region.w : region.x + region.w / 2;

  // Measure: title as big as fits (3 lines on the side, 2 at the bottom), artist and tag scaled from it.
  const maxTitle = (side ? H * 0.16 : H * 0.12) * th.size;
  const t = title
    ? fitText(ctx, title, (s) => `${f.weight} ${s.toFixed(1)}px ${f.family}`, maxTitle, region.w, side ? 3 : 1)
    : null;
  const ref = t?.size ?? maxTitle * 0.8;
  const aSize = Math.min(ref * 0.46, H * 0.07 * th.size);
  const a = artist
    ? fitText(ctx, artist, (s) => `${th.font === 'serif' ? 'italic ' : ''}${th.font === 'condensed' ? '400' : '600'} ${s.toFixed(1)}px ${th.font === 'condensed' ? '"Helvetica Neue", Arial, sans-serif' : f.family}`, aSize, region.w, 1)
    : null;
  const tagSize = Math.max(16, ref * 0.26);
  const lineH = (b: Block) => b.size * (th.style === 'band' ? 1.22 : 1.02);
  const gap = ref * 0.22;
  const blockH =
    (tag ? tagSize * 1.9 + gap : 0) + (t ? t.lines.length * lineH(t) : 0) + (t && a ? gap : 0) + (a ? a.size * 1.15 : 0);
  let y = region.y + (region.h - blockH) / 2;

  // Scrim: darkens the text side so light photos stay readable.
  if (th.scrim > 0 && th.style !== 'band') {
    const s = th.scrim * 0.75;
    const g =
      th.layout === 'left'
        ? ctx.createLinearGradient(0, 0, W * 0.62, 0)
        : th.layout === 'right'
          ? ctx.createLinearGradient(W, 0, W * 0.38, 0)
          : ctx.createLinearGradient(0, H, 0, H * 0.55);
    g.addColorStop(0, `rgba(0,0,0,${s})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = align;
  const shadow = (on: boolean, size: number) => {
    ctx.shadowColor = on ? 'rgba(0,0,0,0.65)' : 'transparent';
    ctx.shadowBlur = on ? size * 0.3 : 0;
    ctx.shadowOffsetY = on ? size * 0.06 : 0;
  };

  if (tag) {
    ctx.font = `700 ${tagSize.toFixed(1)}px "Helvetica Neue", Arial, sans-serif`;
    const tw = ctx.measureText(tag).width + tagSize * 1.2;
    const th2 = tagSize * 1.6;
    const tx = align === 'left' ? x : align === 'right' ? x - tw : x - tw / 2;
    shadow(false, tagSize);
    ctx.fillStyle = th.accent;
    ctx.beginPath();
    ctx.roundRect(tx, y, tw, th2, th2 * 0.22);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(tag, tx + tw / 2, y + th2 * 0.7);
    ctx.textAlign = align;
    y += tagSize * 1.9 + gap;
  }

  if (t) {
    ctx.font = t.font;
    for (const line of t.lines) {
      const h = lineH(t);
      if (th.style === 'band') {
        const w = ctx.measureText(line).width + t.size * 0.4;
        const bx = align === 'left' ? x - t.size * 0.2 : align === 'right' ? x - w + t.size * 0.2 : x - w / 2;
        shadow(false, t.size);
        ctx.fillStyle = th.accent;
        ctx.fillRect(bx, y + h * 0.04, w, h * 0.96);
      }
      shadow(th.style === 'shadow', t.size);
      ctx.fillStyle = th.color;
      drawTextLine(ctx, line, x, y + h * (th.style === 'band' ? 0.8 : 0.86), t.size, th);
      y += h;
    }
    if (a) y += gap;
  }

  if (a) {
    ctx.font = a.font;
    const band = th.style === 'band';
    if (band) {
      // A dark strip under the artist, so it reads on light backgrounds too.
      const line = a.lines[0] ?? '';
      const w = ctx.measureText(line).width + a.size * 0.5;
      const bx = align === 'left' ? x - a.size * 0.25 : align === 'right' ? x - w + a.size * 0.25 : x - w / 2;
      shadow(false, a.size);
      ctx.fillStyle = 'rgba(12,12,14,0.88)';
      ctx.fillRect(bx, y - a.size * 0.05, w, a.size * 1.25);
    }
    shadow(!band, a.size);
    ctx.fillStyle = band ? '#ffffff' : th.color;
    ctx.globalAlpha = band ? 1 : 0.92;
    drawTextLine(ctx, a.lines[0] ?? '', x, y + a.size * 0.9, a.size, th);
  }
  ctx.restore();
}

/** Draws the thumbnail on a canvas of any size (the layout is relative to its dimensions). */
export function renderThumbnail(
  ctx: Ctx2D,
  cfg: SceneConfig,
  th: ThumbConfig,
  images: SceneImages,
  factory: CanvasFactory,
): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const scene = thumbSceneConfig(cfg, th, W, H);
  const assets = buildAssets(scene, images, W, H, factory);
  const layer = factory(W, H);
  const lctx = layer.getContext('2d') as Ctx2D;
  renderFrame(lctx, th.pose === 'in' ? 0 : { seg: 'loop', i: 0 }, scene, assets);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (th.background === 'blur' && images.cover) drawBlurredPhoto(ctx, images.cover, W, H, factory);
  else if (th.background === 'blur' || scene.background.id === 'transparent') {
    // No photo to blur (or a transparent scene): a dark backdrop from the palette.
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#1b1b1f');
    g.addColorStop(1, cfg.background.palette[2] ?? '#2a2a30');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  // The scene's own background (when used) is drawn by renderFrame into the layer.
  ctx.drawImage(layer, 0, 0);
  if (th.layout !== 'clean') drawThumbText(ctx, W, H, cfg, th);
  ctx.restore();
}
