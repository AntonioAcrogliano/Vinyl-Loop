import type { Ctx2D } from '../types';
import { blobs } from './blobs';
import { bokeh } from './bokeh';
import { gradient } from './gradient';
import { particles } from './particles';
import { rays } from './rays';
import { retro } from './retro';
import { solid } from './solid';

export interface ParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** Optional labels for small integer choices (rendered as a select). */
  options?: string[];
}

/**
 * Every background must be periodic in `phase` (period 1, or 1/k with integer k) so the
 * loop closes. Speeds are chosen as cycles per loop (integers), never as free values.
 */
export interface Background {
  id: string;
  label: string;
  /** True if the background paints nothing (enables checkerboard preview, disables MP4). */
  transparent?: boolean;
  params?: ParamDef[];
  draw(ctx: Ctx2D, phase: number, w: number, h: number, palette: string[], params: Record<string, number>): void;
}

export const transparent: Background = {
  id: 'transparent',
  label: 'Transparente',
  transparent: true,
  draw() {},
};

export const BACKGROUNDS: Background[] = [transparent, solid, gradient, blobs, rays, particles, retro, bokeh];

export function getBackground(id: string): Background {
  return BACKGROUNDS.find((b) => b.id === id) ?? transparent;
}

/** Background params with defaults filled in; integer params are rounded. */
export function resolveParams(bg: Background, params: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of bg.params ?? []) {
    const v = params[d.key];
    const x = typeof v === 'number' && Number.isFinite(v) ? Math.min(d.max, Math.max(d.min, v)) : d.default;
    out[d.key] = Number.isInteger(d.step) ? Math.round(x) : x;
  }
  return out;
}
