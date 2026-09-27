import type { CanvasFactory, Ctx2D, ImageLike } from '../render/types';
import { mulberry32 } from './prng';

type RGB = [number, number, number];

const toHex = ([r, g, b]: RGB) =>
  '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

function dist2(a: RGB, b: RGB): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  // Weighted toward perceived luminance differences.
  return 0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db;
}

/** Deterministic k-means (seeded k-means++ init) on a list of pixels. Sorted by population. */
export function kmeans(pixels: RGB[], k: number, iterations = 12, seed = 1): { color: RGB; count: number }[] {
  if (pixels.length === 0) return [];
  const rand = mulberry32(seed);
  const centers: RGB[] = [pixels[Math.floor(rand() * pixels.length)]];
  while (centers.length < k) {
    const d = pixels.map((p) => Math.min(...centers.map((c) => dist2(p, c))));
    const total = d.reduce((a, b) => a + b, 0);
    if (total === 0) break;
    let r = rand() * total;
    let idx = 0;
    while (idx < d.length - 1 && r > d[idx]) r -= d[idx++];
    centers.push(pixels[idx]);
  }
  const assign = new Int32Array(pixels.length);
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < pixels.length; i++) {
      let best = 0;
      let bd = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const dd = dist2(pixels[i], centers[c]);
        if (dd < bd) {
          bd = dd;
          best = c;
        }
      }
      assign[i] = best;
    }
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < pixels.length; i++) {
      const s = sums[assign[i]];
      s[0] += pixels[i][0];
      s[1] += pixels[i][1];
      s[2] += pixels[i][2];
      s[3]++;
    }
    for (let c = 0; c < centers.length; c++) if (sums[c][3]) centers[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]];
  }
  const counts = centers.map(() => 0);
  for (let i = 0; i < pixels.length; i++) counts[assign[i]]++;
  return centers.map((color, i) => ({ color, count: counts[i] })).sort((a, b) => b.count - a.count);
}

/** 3–5 dominant colors of an image, most common first, as hex strings. */
export function extractPalette(img: ImageLike, factory: CanvasFactory, k = 5): string[] {
  const size = 48;
  const canvas = factory(size, size);
  const ctx = canvas.getContext('2d') as Ctx2D;
  ctx.drawImage(img, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;
  const px: RGB[] = [];
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 128) px.push([data[i], data[i + 1], data[i + 2]]);
  // Over-cluster, then pick greedily: the dominant color first, then whichever cluster best
  // balances "different from what we have" and "present enough" (so a small vivid accent
  // beats a third shade of the main gradient).
  const clusters = kmeans(px, Math.max(k, 10)).filter((c) => c.count > 0);
  if (clusters.length === 0) return [];
  const out = [clusters[0]];
  const rest = clusters.slice(1);
  while (out.length < k && rest.length) {
    let best = -1;
    let score = -1;
    rest.forEach((c, i) => {
      const d = Math.min(...out.map((o) => dist2(o.color, c.color)));
      const s = Math.sqrt(d) * Math.pow(c.count / px.length, 0.35);
      if (d > 250 && s > score) {
        score = s;
        best = i;
      }
    });
    if (best < 0) break;
    out.push(rest.splice(best, 1)[0]);
  }
  return out.map((c) => toHex(c.color));
}
