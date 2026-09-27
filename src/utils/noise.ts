import { mulberry32 } from './prng';

// Seeded 4D simplex noise (after Stefan Gustavson's public-domain reference).
// Sampling the extra two dimensions on a circle, noise(x, y, cos(2πφ)·r, sin(2πφ)·r),
// gives organic motion that returns exactly to its start when φ wraps.

const G4 = [
  [0, 1, 1, 1], [0, 1, 1, -1], [0, 1, -1, 1], [0, 1, -1, -1], [0, -1, 1, 1], [0, -1, 1, -1], [0, -1, -1, 1], [0, -1, -1, -1],
  [1, 0, 1, 1], [1, 0, 1, -1], [1, 0, -1, 1], [1, 0, -1, -1], [-1, 0, 1, 1], [-1, 0, 1, -1], [-1, 0, -1, 1], [-1, 0, -1, -1],
  [1, 1, 0, 1], [1, 1, 0, -1], [1, -1, 0, 1], [1, -1, 0, -1], [-1, 1, 0, 1], [-1, 1, 0, -1], [-1, -1, 0, 1], [-1, -1, 0, -1],
  [1, 1, 1, 0], [1, 1, -1, 0], [1, -1, 1, 0], [1, -1, -1, 0], [-1, 1, 1, 0], [-1, 1, -1, 0], [-1, -1, 1, 0], [-1, -1, -1, 0],
];
const F4 = (Math.sqrt(5) - 1) / 4;
const Gf4 = (5 - Math.sqrt(5)) / 20;

export type Noise4 = (x: number, y: number, z: number, w: number) => number;

export function createNoise4(seed: number): Noise4 {
  const rand = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  const corner = (x: number, y: number, z: number, w: number, gi: number) => {
    let t = 0.6 - x * x - y * y - z * z - w * w;
    if (t < 0) return 0;
    t *= t;
    const g = G4[gi];
    return t * t * (g[0] * x + g[1] * y + g[2] * z + g[3] * w);
  };

  return (x, y, z, w) => {
    const s = (x + y + z + w) * F4;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const k = Math.floor(z + s);
    const l = Math.floor(w + s);
    const t = (i + j + k + l) * Gf4;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const z0 = z - (k - t);
    const w0 = w - (l - t);
    // Rank the coordinates to find the simplex we're in.
    let rx = 0;
    let ry = 0;
    let rz = 0;
    let rw = 0;
    if (x0 > y0) rx++; else ry++;
    if (x0 > z0) rx++; else rz++;
    if (x0 > w0) rx++; else rw++;
    if (y0 > z0) ry++; else rz++;
    if (y0 > w0) ry++; else rw++;
    if (z0 > w0) rz++; else rw++;
    const o = [
      [rx >= 3 ? 1 : 0, ry >= 3 ? 1 : 0, rz >= 3 ? 1 : 0, rw >= 3 ? 1 : 0],
      [rx >= 2 ? 1 : 0, ry >= 2 ? 1 : 0, rz >= 2 ? 1 : 0, rw >= 2 ? 1 : 0],
      [rx >= 1 ? 1 : 0, ry >= 1 ? 1 : 0, rz >= 1 ? 1 : 0, rw >= 1 ? 1 : 0],
    ];
    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;
    const ll = l & 255;
    const gi = (a: number, b: number, c: number, d: number) =>
      perm[ii + a + perm[jj + b + perm[kk + c + perm[ll + d]]]] % 32;
    let n = corner(x0, y0, z0, w0, gi(0, 0, 0, 0));
    for (let q = 0; q < 3; q++) {
      const [a, b, c, d] = o[q];
      const off = (q + 1) * Gf4;
      n += corner(x0 - a + off, y0 - b + off, z0 - c + off, w0 - d + off, gi(a, b, c, d));
    }
    n += corner(x0 - 1 + 4 * Gf4, y0 - 1 + 4 * Gf4, z0 - 1 + 4 * Gf4, w0 - 1 + 4 * Gf4, gi(1, 1, 1, 1));
    return 27 * n; // roughly -1..1
  };
}

/** Periodic noise: value at (x, y) for loop phase φ, with period 1 in φ. */
export function loopNoise(noise: Noise4, x: number, y: number, phase: number, radius = 1): number {
  const a = phase * Math.PI * 2;
  return noise(x, y, Math.cos(a) * radius, Math.sin(a) * radius);
}
