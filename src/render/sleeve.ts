import { mulberry32 } from '../utils/prng';
import { drawCropped } from './crop';
import { DISC_TO_SLEEVE } from './layout';
import type { AnyCanvas, CanvasFactory, CoverStyle, Crop, Ctx2D, Direction, ImageLike, SleeveMaterial, Sprite } from './types';

export interface SleeveOptions {
  size: number;
  cover: ImageLike | null;
  crop: Crop;
  /** Side where the opening is (the disc comes out that way). */
  direction: Direction;
  /** Ring wear, rubbed edges and aging, 0..1. */
  wear?: number;
  style?: CoverStyle;
  material?: SleeveMaterial;
  /** Used by the "color" material. */
  color?: string;
  /** Die-cut hole radius as a fraction of the sleeve side. */
  holeRadius?: number;
}

/** Die-cut hole: a bit larger than the label, so the whole label shows when the disc is inside. */
export function holeRadiusFor(labelSize: number): number {
  return ((DISC_TO_SLEEVE * labelSize) / 2) * 1.1;
}

const MATERIAL_BASE: Record<Exclude<SleeveMaterial, 'photo' | 'color'>, string> = {
  kraft: '#b08555',
  white: '#f1eee7',
  black: '#1d1d1f',
};

function materialColor(material: SleeveMaterial, color: string): string {
  if (material === 'color') return /^#[0-9a-f]{6}$/i.test(color) ? color : '#2f4858';
  if (material === 'photo') return '#d8d1c3';
  return MATERIAL_BASE[material];
}

/** Flat paper with seeded grain and a few fibers (strength ~ how rough the paper is). */
function drawPaper(ctx: Ctx2D, size: number, base: string, strength: number, seed: number): void {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const rand = mulberry32(seed);
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() + rand() - 1) * strength;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  ctx.lineWidth = Math.max(0.5, size * 0.0012);
  for (let k = 0; k < Math.round(strength * 12); k++) {
    const x = rand() * size;
    const y = rand() * size;
    const a = rand() * Math.PI;
    const l = size * (0.01 + rand() * 0.04);
    ctx.strokeStyle = rand() < 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
}

export function sleeveRadius(size: number): number {
  return size * 0.012;
}

export function roundRectPath(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/** Pre-renders the jacket: cropped cover, rounded corners, edge shading and the opening. */
export function buildSleeveCanvas(factory: CanvasFactory, opts: SleeveOptions): AnyCanvas {
  const size = Math.max(16, Math.round(opts.size));
  const canvas = factory(size, size);
  const ctx = canvas.getContext('2d') as Ctx2D;
  const rad = sleeveRadius(size);

  ctx.save();
  roundRectPath(ctx, 0, 0, size, size, rad);
  ctx.clip();
  const dieCut = opts.style === 'dieCut';
  const material = opts.material ?? 'kraft';
  if (!dieCut || material === 'photo') {
    if (opts.cover) {
      ctx.imageSmoothingQuality = 'high';
      drawCropped(ctx, opts.cover, opts.crop, 0, 0, size);
    } else {
      drawPlaceholderCover(ctx, size);
    }
  } else {
    drawPaper(ctx, size, materialColor(material, opts.color ?? ''), material === 'kraft' ? 14 : 5, 0x5ee7);
  }
  if (opts.wear && opts.wear > 0) drawWear(ctx, size, opts.wear);

  // Cardboard edges: slight darkening toward the border, light from top-left.
  const e = size * 0.035;
  const edge = (x0: number, y0: number, x1: number, y1: number, alpha: number) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, `rgba(0,0,0,${alpha})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  };
  edge(0, 0, e, 0, 0.12);
  edge(size, 0, size - e, 0, 0.12);
  edge(0, 0, 0, e, 0.1);
  edge(0, size, 0, size - e, 0.16);
  const light = ctx.createLinearGradient(0, 0, size, size);
  light.addColorStop(0, 'rgba(255,255,255,0.10)');
  light.addColorStop(0.5, 'rgba(255,255,255,0)');
  light.addColorStop(1, 'rgba(0,0,0,0.08)');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, size, size);

  // The opening: a darker seam along the side the disc exits from.
  const o = size * 0.02;
  const [x0, y0, x1, y1] =
    opts.direction === 'right' ? [size, 0, size - o, 0] : opts.direction === 'left' ? [0, 0, o, 0] : [0, 0, 0, o];
  edge(x0, y0, x1, y1, 0.35);
  ctx.restore();

  if (dieCut) {
    const c = size / 2;
    const hr = (opts.holeRadius ?? 0.17) * size;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(c, c, hr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Cut edge: thin dark rim plus a faint highlight where the light hits the paper thickness.
    ctx.lineWidth = Math.max(1, size * 0.004);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.arc(c, c, hr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = Math.max(0.5, size * 0.0015);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.arc(c, c, hr + size * 0.003, Math.PI * 0.9, Math.PI * 1.6);
    ctx.stroke();
  }

  // Fine outline.
  roundRectPath(ctx, 0.5, 0.5, size - 1, size - 1, rad);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.stroke();
  return canvas;
}

/**
 * Inside of a die-cut sleeve: the back panel seen through the hole once the disc is out.
 * Darker than the front because the front panel shades it.
 */
export function buildSleeveBackCanvas(factory: CanvasFactory, size: number, material: SleeveMaterial, color: string): AnyCanvas {
  const s = Math.max(16, Math.round(size));
  const canvas = factory(s, s);
  const ctx = canvas.getContext('2d') as Ctx2D;
  drawPaper(ctx, s, materialColor(material, color), material === 'kraft' ? 12 : 4, 0xbac4);
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s * 0.7);
  g.addColorStop(0, 'rgba(0,0,0,0.28)');
  g.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return canvas;
}

/** Seeded, so the same wear setting always looks the same. */
function drawWear(ctx: Ctx2D, size: number, wear: number): void {
  const rand = mulberry32(0x7ea2);
  const TAU = Math.PI * 2;

  // Aging: slight yellowing and loss of saturation.
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = `rgba(239,224,189,${(0.4 * wear).toFixed(3)})`;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'saturation';
  ctx.fillStyle = `rgba(128,128,128,${(0.35 * wear).toFixed(3)})`;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();

  // Ring wear: the record's outline rubbed into the cardboard, broken up by noise.
  const c = size / 2;
  const ring = (radius: number, width: number, strength: number) => {
    const steps = 180;
    let n = rand();
    ctx.lineWidth = width;
    for (let k = 0; k < steps; k++) {
      n = n * 0.8 + rand() * 0.2; // smoothed noise along the ring
      const a = (0.25 + 0.75 * n) * strength * wear;
      ctx.strokeStyle = `rgba(255,252,244,${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(c, c, radius + (rand() - 0.5) * width * 0.4, (k / steps) * TAU, ((k + 1.3) / steps) * TAU);
      ctx.stroke();
    }
  };
  const inside = ctx.createRadialGradient(c, c, size * 0.3, c, c, size * 0.47);
  inside.addColorStop(0, `rgba(255,255,255,${(0.04 * wear).toFixed(3)})`);
  inside.addColorStop(1, `rgba(255,255,255,${(0.1 * wear).toFixed(3)})`);
  ctx.fillStyle = inside;
  ctx.beginPath();
  ctx.arc(c, c, size * 0.465, 0, TAU);
  ctx.fill();
  ring(size * 0.462, size * 0.014, 0.45);
  ring(size * 0.165, size * 0.008, 0.22);

  // Rubbed corners.
  for (const [x, y] of [[0, 0], [size, 0], [0, size], [size, size]]) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, size * 0.07);
    g.addColorStop(0, `rgba(255,250,240,${(0.55 * wear).toFixed(3)})`);
    g.addColorStop(1, 'rgba(255,250,240,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - size * 0.07, y - size * 0.07, size * 0.14, size * 0.14);
  }

  // Worn edges: specks concentrated near the border.
  const specks = Math.round(1400 * wear);
  for (let k = 0; k < specks; k++) {
    const side = Math.floor(rand() * 4);
    const along = rand() * size;
    const depth = -Math.log(1 - rand() * 0.999) * size * 0.01;
    const [x, y] = side === 0 ? [along, depth] : side === 1 ? [size - depth, along] : side === 2 ? [along, size - depth] : [depth, along];
    const r = size * (0.0008 + rand() * 0.003);
    ctx.fillStyle = `rgba(255,250,240,${(0.2 + rand() * 0.6).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r * (1 + rand() * 2), r, rand() * Math.PI, 0, TAU);
    ctx.fill();
  }

  // A few faint scratches.
  ctx.lineWidth = Math.max(0.5, size * 0.0012);
  for (let k = 0; k < Math.round(10 * wear); k++) {
    const x = rand() * size;
    const y = rand() * size;
    const a = rand() * Math.PI;
    const l = size * (0.05 + rand() * 0.15);
    ctx.strokeStyle = `rgba(255,255,255,${(0.12 + rand() * 0.15).toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + l * 0.05, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
}

/** White paper inner sleeve (drawn behind the disc, peeking out of the opening). */
export function buildPaperCanvas(factory: CanvasFactory, size: number): AnyCanvas {
  const s = Math.max(16, Math.round(size));
  const canvas = factory(s, s);
  const ctx = canvas.getContext('2d') as Ctx2D;
  roundRectPath(ctx, 0, 0, s, s, s * 0.02);
  const g = ctx.createLinearGradient(0, 0, s, s);
  g.addColorStop(0, '#f7f4ee');
  g.addColorStop(1, '#e6e1d6');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.002);
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.stroke();
  // Soft crease lines of thin paper.
  const rand = mulberry32(0x9a9e);
  for (let k = 0; k < 5; k++) {
    const x = rand() * s;
    const gr = ctx.createLinearGradient(x - s * 0.03, 0, x + s * 0.03, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(0.5, 'rgba(0,0,0,0.035)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(x - s * 0.03, 0, s * 0.06, s);
  }
  return canvas;
}

function drawPlaceholderCover(ctx: Ctx2D, size: number): void {
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, '#2f4858');
  g.addColorStop(1, '#86bbd8');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.arc(size * 0.5, size * 0.5, size * 0.18, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Pre-rendered blurred silhouette for shadows. Uses the offset-shadow trick (the shape is
 * drawn off-canvas and only its shadow lands inside), which works everywhere, unlike ctx.filter.
 */
export function buildShadowSprite(
  factory: CanvasFactory,
  w: number,
  h: number,
  blur: number,
  shape: (ctx: Ctx2D, x: number, y: number, w: number, h: number) => void,
): Sprite {
  const pad = Math.ceil(blur * 2.5);
  const cw = Math.max(1, Math.round(w + pad * 2));
  const ch = Math.max(1, Math.round(h + pad * 2));
  const canvas = factory(cw, ch);
  const ctx = canvas.getContext('2d') as Ctx2D;
  const far = cw + ch + 1000;
  ctx.shadowColor = 'rgba(0,0,0,1)';
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = far;
  ctx.fillStyle = '#000';
  shape(ctx, pad - far, pad, w, h);
  return { canvas, pad };
}
