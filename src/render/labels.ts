import type { Ctx2D } from './types';

// Standard record labels, drawn procedurally (no brands). Every preset draws a label of
// radius r centered at (0, 0); the caller clips to the circle and adds the spindle hole.

export interface LabelTexts {
  title: string;
  subtitle: string;
  /** e.g. "33⅓ RPM" */
  rpm: string;
}

export interface LabelPreset {
  id: string;
  name: string;
  /** Default base color; the user can override it. */
  base: string;
  draw(ctx: Ctx2D, r: number, base: string, t: LabelTexts): void;
}

const SERIF = 'Georgia, "Times New Roman", Times, serif';
const SANS = '"Helvetica Neue", Helvetica, Arial, system-ui, sans-serif';

function font(ctx: Ctx2D, weight: string, size: number, family: string): void {
  ctx.font = `${weight} ${Math.max(1, size).toFixed(2)}px ${family}`;
}

/** Centered single line, shrunk to fit maxWidth. */
function text(ctx: Ctx2D, s: string, x: number, y: number, size: number, maxWidth: number, weight = '600', family = SANS): void {
  if (!s) return;
  font(ctx, weight, size, family);
  const w = ctx.measureText(s).width;
  if (w > maxWidth) font(ctx, weight, (size * maxWidth) / w, family);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
}

/**
 * Text along a circle, centered on the top (bottom = false) or bottom (bottom = true, still
 * reading left to right). Spreads the letters at most over `maxArc` radians.
 */
function arcText(ctx: Ctx2D, s: string, radius: number, size: number, bottom: boolean, weight = '700', family = SANS, maxArc = Math.PI * 0.9, spacing = 0.08): void {
  if (!s) return;
  font(ctx, weight, size, family);
  const chars = [...s];
  const widths = chars.map((c) => ctx.measureText(c).width + size * spacing);
  let total = widths.reduce((a, b) => a + b, 0) / radius;
  let scale = 1;
  if (total > maxArc) {
    scale = maxArc / total;
    font(ctx, weight, size * scale, family);
    total = maxArc;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let a = bottom ? Math.PI / 2 + total / 2 : -Math.PI / 2 - total / 2;
  chars.forEach((c, i) => {
    const step = (widths[i] * scale) / radius;
    const mid = bottom ? a - step / 2 : a + step / 2;
    ctx.save();
    ctx.rotate(mid);
    ctx.translate(radius, 0);
    ctx.rotate(bottom ? -Math.PI / 2 : Math.PI / 2);
    ctx.fillText(c, 0, 0);
    ctx.restore();
    a = bottom ? a - step : a + step;
  });
}

function ring(ctx: Ctx2D, radius: number, width: number, color: string): void {
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
}

function fill(ctx: Ctx2D, r: number, color: string | CanvasGradient): void {
  ctx.fillStyle = color;
  ctx.fillRect(-r, -r, r * 2, r * 2);
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mix toward white (t > 0) or black (t < 0). */
function tint(hex: string, t: number): string {
  const [r, g, b] = hexToRgb(hex);
  const target = t > 0 ? 255 : 0;
  const f = (v: number) => Math.round(v + (target - v) * Math.abs(t));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

/** Black or cream text, whichever reads better on the base color. */
function ink(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#1a1a1a' : '#f4ecd8';
}

export const LABEL_PRESETS: LabelPreset[] = [
  {
    id: 'classic',
    name: 'Clásica',
    base: '#b3202a',
    draw(ctx, r, base, t) {
      const c = ink(base);
      fill(ctx, r, base);
      ring(ctx, r * 0.9, r * 0.018, c);
      ring(ctx, r * 0.855, r * 0.006, c);
      ctx.fillStyle = c;
      arcText(ctx, t.title.toUpperCase(), r * 0.68, r * 0.15, false, '700', SERIF, Math.PI * 0.85);
      text(ctx, t.subtitle, 0, r * 0.44, r * 0.13, r * 1.1, 'italic 400', SERIF);
      text(ctx, 'LADO A', -r * 0.52, 0, r * 0.075, r * 0.4, '700');
      text(ctx, t.rpm, r * 0.52, 0, r * 0.075, r * 0.4, '700');
      ring(ctx, r * 0.14, r * 0.01, c);
    },
  },
  {
    id: 'blackGold',
    name: 'Negra y dorada',
    base: '#161616',
    draw(ctx, r, base, t) {
      fill(ctx, r, base);
      const gold = ctx.createLinearGradient(-r, -r, r, r);
      gold.addColorStop(0, '#f6e27a');
      gold.addColorStop(0.5, '#b8891e');
      gold.addColorStop(1, '#f3d36b');
      ring(ctx, r * 0.93, r * 0.02, '#c9a23a');
      ring(ctx, r * 0.88, r * 0.006, '#c9a23a');
      ctx.fillStyle = gold;
      // Small diamond emblem.
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.66);
      ctx.lineTo(r * 0.07, -r * 0.56);
      ctx.lineTo(0, -r * 0.46);
      ctx.lineTo(-r * 0.07, -r * 0.56);
      ctx.closePath();
      ctx.fill();
      text(ctx, t.title.toUpperCase(), 0, -r * 0.27, r * 0.16, r * 1.3, '800');
      text(ctx, t.subtitle, 0, r * 0.3, r * 0.12, r * 1.2, '400');
      text(ctx, t.rpm, 0, r * 0.62, r * 0.08, r * 0.6, '700');
    },
  },
  {
    id: 'promo',
    name: 'Promo blanca',
    base: '#f1ede3',
    draw(ctx, r, base, t) {
      const c = ink(base);
      fill(ctx, r, base);
      ring(ctx, r * 0.9, r * 0.008, c);
      ctx.fillStyle = c;
      text(ctx, t.title.toUpperCase(), 0, -r * 0.3, r * 0.15, r * 1.3, '800');
      text(ctx, t.subtitle, 0, r * 0.28, r * 0.12, r * 1.2, '400');
      arcText(ctx, 'COPIA PROMOCIONAL · PROHIBIDA SU VENTA', r * 0.78, r * 0.06, true, '600', SANS, Math.PI * 0.8, 0.04);
      text(ctx, t.rpm, r * 0.55, 0, r * 0.07, r * 0.35, '700');
      // Stamp.
      ctx.save();
      ctx.rotate(-0.25);
      ctx.strokeStyle = '#c0392b';
      ctx.fillStyle = '#c0392b';
      ctx.lineWidth = r * 0.02;
      ctx.strokeRect(-r * 0.3, -r * 0.7, r * 0.6, r * 0.2);
      text(ctx, 'PROMO', 0, -r * 0.6, r * 0.13, r * 0.5, '900');
      ctx.restore();
    },
  },
  {
    id: 'blue',
    name: 'Azul vintage',
    base: '#1f4e9c',
    draw(ctx, r, base, t) {
      const g = ctx.createRadialGradient(0, -r * 0.2, 0, 0, 0, r);
      g.addColorStop(0, tint(base, 0.25));
      g.addColorStop(1, tint(base, -0.25));
      fill(ctx, r, g);
      for (let k = 0; k < 3; k++) ring(ctx, r * (0.95 - k * 0.025), r * 0.006, 'rgba(225,230,240,0.8)');
      ctx.fillStyle = '#e6eaf2';
      arcText(ctx, t.title.toUpperCase(), r * 0.7, r * 0.14, false, '700', SANS, Math.PI * 0.8);
      arcText(ctx, t.subtitle, r * 0.72, r * 0.11, true, '400', SERIF, Math.PI * 0.7);
      text(ctx, t.rpm, 0, -r * 0.3, r * 0.08, r * 0.6, '700');
    },
  },
  {
    id: 'yellow',
    name: 'Amarilla',
    base: '#f2c230',
    draw(ctx, r, base, t) {
      const c = ink(base);
      fill(ctx, r, base);
      ring(ctx, r * 0.965, r * 0.05, c);
      ctx.fillStyle = c;
      // Heavy weights often lack the "⅓" glyph: draw the fraction separately in a lighter weight.
      const num = t.rpm.replace(' RPM', '');
      if (num.endsWith('⅓')) {
        text(ctx, num.slice(0, -1), -r * 0.06, -r * 0.5, r * 0.28, r * 0.8, '900');
        text(ctx, '⅓', r * 0.2, -r * 0.55, r * 0.14, r * 0.3, '700');
      } else {
        text(ctx, num, 0, -r * 0.5, r * 0.28, r * 0.9, '900');
      }
      text(ctx, 'RPM', 0, -r * 0.28, r * 0.07, r * 0.4, '700');
      text(ctx, t.title.toUpperCase(), 0, r * 0.3, r * 0.14, r * 1.3, '800');
      text(ctx, t.subtitle, 0, r * 0.52, r * 0.11, r * 1.1, '400');
    },
  },
  {
    id: 'split',
    name: 'Bicolor',
    base: '#e63946',
    draw(ctx, r, base, t) {
      const light = '#f5efe0';
      ctx.fillStyle = base;
      ctx.fillRect(-r, -r, r * 2, r);
      ctx.fillStyle = light;
      ctx.fillRect(-r, 0, r * 2, r);
      ctx.fillStyle = ink(base);
      text(ctx, t.title.toUpperCase(), 0, -r * 0.42, r * 0.15, r * 1.3, '800');
      text(ctx, t.rpm, 0, -r * 0.18, r * 0.07, r * 0.6, '700');
      ctx.fillStyle = base;
      text(ctx, t.subtitle, 0, r * 0.38, r * 0.12, r * 1.2, '600');
      text(ctx, 'LADO A', 0, r * 0.62, r * 0.07, r * 0.5, '700');
    },
  },
  {
    id: 'sunburst',
    name: 'Sunburst',
    base: '#f28c28',
    draw(ctx, r, base, t) {
      fill(ctx, r, tint(base, 0.45));
      ctx.fillStyle = base;
      const n = 24;
      ctx.beginPath();
      for (let k = 0; k < n; k += 2) {
        const a = (k / n) * Math.PI * 2;
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, r * 1.5, a, a + (Math.PI * 2) / n);
        ctx.closePath();
      }
      ctx.fill();
      // Center plate with the texts.
      ctx.fillStyle = '#fbf6ea';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
      ctx.fill();
      ring(ctx, r * 0.62, r * 0.02, tint(base, -0.3));
      ctx.fillStyle = '#1a1a1a';
      text(ctx, t.title.toUpperCase(), 0, -r * 0.3, r * 0.12, r * 0.95, '800');
      text(ctx, t.subtitle, 0, r * 0.28, r * 0.1, r * 0.95, '400');
      text(ctx, t.rpm, 0, r * 0.46, r * 0.06, r * 0.5, '700');
    },
  },
  {
    id: 'minimal',
    name: 'Minimal',
    base: '#2a9d8f',
    draw(ctx, r, base, t) {
      fill(ctx, r, base);
      ring(ctx, r * 0.8, r * 0.006, 'rgba(255,255,255,0.45)');
      ctx.fillStyle = ink(base);
      text(ctx, t.title, 0, -r * 0.34, r * 0.11, r * 1.1, '600');
      text(ctx, t.subtitle, 0, r * 0.34, r * 0.085, r * 1.1, '400');
    },
  },
];

export function getLabelPreset(id: string): LabelPreset {
  return LABEL_PRESETS.find((p) => p.id === id) ?? LABEL_PRESETS[0];
}

/** Draws a preset label of radius r centered at (cx, cy), clipped to its circle. */
export function drawLabelPreset(ctx: Ctx2D, cx: number, cy: number, r: number, id: string, color: string, texts: LabelTexts): void {
  const p = getLabelPreset(id);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.clip();
  p.draw(ctx, r, /^#[0-9a-f]{6}$/i.test(color) ? color : p.base, texts);
  ctx.restore();
}

/** "33⅓ RPM", "45 RPM", "50,5 RPM" */
export function rpmText(rpm: number): string {
  if (Math.abs(rpm - 100 / 3) < 0.01) return '33⅓ RPM';
  return `${Number(rpm.toFixed(1)).toLocaleString('es-AR')} RPM`;
}
