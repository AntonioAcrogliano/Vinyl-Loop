const FALLBACK = ['#e9e4da', '#c8322d', '#1d3557', '#f1c453', '#2a9d8f'];

/** Palette color i, cycling; falls back to defaults for empty palettes. */
export function pc(palette: string[], i: number): string {
  const p = palette.length ? palette : FALLBACK;
  return p[((i % p.length) + p.length) % p.length];
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(4)})`;
}

/** Mix a hex color toward white (t > 0) or black (t < 0). */
export function shade(hex: string, t: number): string {
  const [r, g, b] = hexToRgb(hex);
  const target = t > 0 ? 255 : 0;
  const k = Math.abs(t);
  const f = (v: number) => Math.round(v + (target - v) * k);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

export const TAU = Math.PI * 2;

/** Fractional part in [0, 1). */
export function frac(x: number): number {
  return x - Math.floor(x);
}
