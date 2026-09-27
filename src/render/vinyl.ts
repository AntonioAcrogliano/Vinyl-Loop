import { mulberry32 } from '../utils/prng';
import { drawCropped } from './crop';
import type { AnyCanvas, CanvasFactory, Crop, Ctx2D, ImageLike, VinylStyle } from './types';

// Radii as fractions of the disc radius.
const HOLE_R = 0.024;
const LEAD_IN = 0.955;
const RIM = 0.988;
const RUN_OUT = 0.06;

export interface DiscOptions {
  size: number;
  label: ImageLike | null;
  labelCrop: Crop;
  /** Label diameter as a fraction of the disc diameter. */
  labelSize: number;
  style?: VinylStyle;
  /** Hex color for the "color" and "translucent" styles. */
  color?: string;
  seed?: number;
}

export function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Pre-renders grooves, label and spindle hole into a square canvas (done once).
 * Each frame only rotates this bitmap with drawImage.
 */
export function buildDiscCanvas(factory: CanvasFactory, opts: DiscOptions): AnyCanvas {
  const size = Math.max(16, Math.round(opts.size));
  const canvas = factory(size, size);
  const ctx = canvas.getContext('2d') as Ctx2D;
  const R = size / 2;
  const labelR = opts.labelSize; // radius fraction == diameter fraction
  const rand = mulberry32(opts.seed ?? 0x51ab1e);

  // Radial luminance profile at half-pixel resolution.
  const M = Math.ceil(R * 2) + 2;
  const fine = new Float32Array(M);
  const medium = new Float32Array(M);
  let m = 0;
  for (let k = 0; k < M; k++) {
    fine[k] = rand() * 2 - 1;
    if (k % 12 === 0) m = rand() * 2 - 1;
    medium[k] = m;
  }
  // Smooth the medium bands so they read as wide sheen variations, not steps.
  const med = new Float32Array(M);
  for (let k = 0; k < M; k++) {
    let s = 0;
    let n = 0;
    for (let q = -12; q <= 12; q++) {
      const idx = k + q;
      if (idx >= 0 && idx < M) {
        s += medium[idx];
        n++;
      }
    }
    med[k] = s / n;
  }

  // Gaps between tracks (smooth, darker bands).
  const grooveStart = labelR + RUN_OUT;
  const gaps: number[] = [];
  const tracks = 4 + Math.floor(rand() * 3);
  for (let g = 1; g < tracks; g++) {
    const u = (g + (rand() - 0.5) * 0.5) / tracks;
    gaps.push(grooveStart + u * (LEAD_IN - grooveStart));
  }
  const gapHalf = 0.0035;

  // Low-frequency angular variation so the rotation is faintly visible on the grooves too.
  const p1 = rand() * Math.PI * 2;
  const p2 = rand() * Math.PI * 2;
  const p3 = rand() * Math.PI * 2;

  const style = opts.style ?? 'black';
  const [cr, cg, cb] = parseHex(opts.color ?? '#b3202a');
  // Translucent vinyl lets the background through; the rim stays a bit denser.
  const bodyAlpha = style === 'translucent' ? 0.74 : 1;

  const img = ctx.createImageData(size, size);
  const data = img.data;
  for (let y = 0; y < size; y++) {
    const py = y + 0.5 - R;
    for (let x = 0; x < size; x++) {
      const px = x + 0.5 - R;
      const rp = Math.sqrt(px * px + py * py);
      const edge = R - rp + 0.5;
      if (edge <= 0) continue;
      const r = rp / R;
      let lum: number;
      if (r > RIM) {
        lum = 30 + 18 * ((r - RIM) / (1 - RIM)); // beveled edge catches light
      } else if (r > LEAD_IN) {
        lum = 17;
      } else if (r > grooveStart) {
        let inGap = false;
        for (const g of gaps) if (Math.abs(r - g) < gapHalf) inGap = true;
        if (inGap) {
          lum = 9;
        } else {
          const k = Math.min(M - 1, Math.floor(rp * 2));
          lum = 19 + 2.5 * (fine[k] + fine[Math.max(0, k - 1)] + fine[Math.min(M - 1, k + 1)]) / 3 + 7 * med[k];
          const a = Math.atan2(py, px);
          lum *= 1 + 0.07 * (0.5 * Math.sin(3 * a + p1) + 0.3 * Math.sin(7 * a + p2) + 0.2 * Math.sin(13 * a + p3));
        }
      } else {
        lum = 14; // run-out
      }
      const o = (y * size + x) * 4;
      let alpha = edge >= 1 ? 1 : edge;
      if (style === 'black') {
        data[o] = lum;
        data[o + 1] = lum;
        data[o + 2] = lum + 2;
      } else {
        // Same groove modulation, applied as brightness over the chosen color.
        const k = 0.42 + 0.031 * lum;
        data[o] = Math.min(255, cr * k);
        data[o + 1] = Math.min(255, cg * k);
        data[o + 2] = Math.min(255, cb * k);
        alpha *= r > RIM ? Math.min(1, bodyAlpha + 0.15) : bodyAlpha;
      }
      data[o + 3] = Math.round(alpha * 255);
    }
  }
  ctx.putImageData(img, 0, 0);

  // Label (photo cropped to a circle).
  const lr = labelR * R;
  ctx.save();
  ctx.beginPath();
  ctx.arc(R, R, lr, 0, Math.PI * 2);
  ctx.clip();
  if (opts.label) {
    ctx.imageSmoothingQuality = 'high';
    drawCropped(ctx, opts.label, opts.labelCrop, R - lr, R - lr, lr * 2);
  } else {
    drawPlaceholderLabel(ctx, R, lr);
  }
  // Soft shading so the label reads as a slightly glossy printed paper.
  const shade = ctx.createRadialGradient(R, R, lr * 0.2, R, R, lr);
  shade.addColorStop(0, 'rgba(0,0,0,0)');
  shade.addColorStop(0.85, 'rgba(0,0,0,0.04)');
  shade.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = shade;
  ctx.fillRect(R - lr, R - lr, lr * 2, lr * 2);
  ctx.restore();

  // Thin border around the label.
  ctx.beginPath();
  ctx.arc(R, R, lr, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1, size * 0.003);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.stroke();

  // Spindle hole.
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(R, R, HOLE_R * R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  return canvas;
}

function drawPlaceholderLabel(ctx: Ctx2D, R: number, lr: number): void {
  ctx.fillStyle = '#c8322d';
  ctx.fillRect(R - lr, R - lr, lr * 2, lr * 2);
  ctx.beginPath();
  ctx.arc(R, R, lr * 0.62, 0, Math.PI * 2);
  ctx.lineWidth = lr * 0.05;
  ctx.strokeStyle = '#efe3c6';
  ctx.stroke();
  ctx.fillStyle = '#efe3c6';
  ctx.fillRect(R - lr * 0.8, R - lr * 0.34, lr * 0.45, lr * 0.08);
  ctx.fillRect(R + lr * 0.35, R - lr * 0.34, lr * 0.45, lr * 0.08);
}

/**
 * Fixed light reflection. It does NOT rotate with the disc, so it adds realism without
 * affecting the loop. Two opposite lobes via a conic gradient, clipped to the grooved ring.
 */
export function drawSheen(
  ctx: Ctx2D,
  cx: number,
  cy: number,
  D: number,
  labelSize: number,
  intensity: number,
  lightAngle = -Math.PI / 4,
): void {
  if (intensity <= 0) return;
  const R = D / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R * RIM, 0, Math.PI * 2);
  ctx.arc(cx, cy, R * (labelSize + 0.01), 0, Math.PI * 2, true);
  ctx.clip();

  const lobes = (a: number, w: number, start: number) => {
    const g = ctx.createConicGradient(start, cx, cy);
    const c = (al: number) => `rgba(255,255,255,${al.toFixed(4)})`;
    g.addColorStop(0, c(a));
    g.addColorStop(w, c(0));
    g.addColorStop(0.5 - w, c(0));
    g.addColorStop(0.5, c(a));
    g.addColorStop(0.5 + w, c(0));
    g.addColorStop(1 - w, c(0));
    g.addColorStop(1, c(a));
    ctx.fillStyle = g;
    ctx.fillRect(cx - R, cy - R, D, D);
  };
  const light = lightAngle;
  lobes(0.16 * intensity, 0.1, light); // wide, soft
  lobes(0.3 * intensity, 0.03, light); // narrow, bright core
  ctx.restore();
}
