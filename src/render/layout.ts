import { textReserve } from './text';
import { clamp01, easeInOutCubic, easeOutCubic } from './timing';
import type { SceneConfig } from './types';

/** Disc diameter relative to sleeve side (12" record in its jacket ≈ 302 / 314 mm). */
export const DISC_TO_SLEEVE = 0.96;

export interface Placement {
  /** Sleeve side and disc diameter, in output pixels. */
  S: number;
  D: number;
  sleeveX: number;
  sleeveY: number;
  /** 0 = sleeve not drawn. */
  sleeveAlpha: number;
  discX: number;
  discY: number;
  /** Disc drawn over the sleeve (only once it no longer overlaps, so the swap is invisible). */
  discFront: boolean;
  /** Unit vector the disc slides out along. */
  dx: number;
  dy: number;
}

export function directionVector(cfg: SceneConfig): [number, number] {
  return cfg.direction === 'right' ? [1, 0] : cfg.direction === 'left' ? [-1, 0] : [0, -1];
}

/**
 * Where everything is for a given pose `move` (0 = disc inside the sleeve, 1 = loop pose).
 * `move` is linear in time; each layout applies its own easing, so the outro (move going
 * 1 → 0) is the intro played backwards, starting at rest.
 */
export function placement(cfg: SceneConfig, W: number, H: number, move: number): Placement {
  const base = Math.min(W, H);
  const S = cfg.sleeveSize * base;
  const D = DISC_TO_SLEEVE * S;
  const [dx, dy] = directionVector(cfg);
  const cx = W / 2 + cfg.offsetX * W;
  // Leave room for the title card: the group moves half the text height away from it.
  const cy = H / 2 + cfg.offsetY * H - textReserve(cfg, W, H) / 2;
  const u = clamp01(move);

  if (cfg.layout === 'solo') {
    // Phase 1: disc slides fully out of a centered group. Phase 2: disc glides to the
    // center while the sleeve leaves (slide away or fade).
    const T = S / 2 + D / 2 + S * 0.02;
    const s1 = easeInOutCubic(u / 0.55);
    const s2 = easeInOutCubic((u - 0.45) / 0.55);
    const sx0 = cx - (dx * T) / 2;
    const sy0 = cy - (dy * T) / 2;
    const outX = sx0 + dx * T * s1;
    const outY = sy0 + dy * T * s1;
    const fade = cfg.soloSleeveExit === 'fade';
    // Distance that takes the sleeve (and its shadow) fully off-canvas.
    const along = dx !== 0 ? W : H;
    const exit = fade ? S * 0.12 : along + S;
    return {
      S,
      D,
      sleeveX: sx0 - dx * exit * s2,
      sleeveY: sy0 - dy * exit * s2,
      sleeveAlpha: fade ? 1 - s2 : s2 >= 1 ? 0 : 1,
      discX: outX + (cx - outX) * s2,
      discY: outY + (cy - outY) * s2,
      discFront: s1 >= 1,
      dx,
      dy,
    };
  }

  // semi / side: static sleeve, disc slides out along d and stays partially over it.
  const p = cfg.discOut;
  const travel = S / 2 - D / 2 + p * D;
  const shift = (p * D) / 2; // centers the sleeve + protruding disc group
  const sleeveX = cx - dx * shift;
  const sleeveY = cy - dy * shift;
  const slide = easeOutCubic(u);
  return {
    S,
    D,
    sleeveX,
    sleeveY,
    sleeveAlpha: 1,
    discX: sleeveX + dx * travel * slide,
    discY: sleeveY + dy * travel * slide,
    discFront: false,
    dx,
    dy,
  };
}
