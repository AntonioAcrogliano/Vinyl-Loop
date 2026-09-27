import { mulberry32 } from '../utils/prng';
import type { AnyCanvas, CanvasFactory, Ctx2D, SceneConfig } from './types';

const TILE = 256;
const TILES = 8;

/** A few pre-rendered gray-noise tiles; each frame picks one plus an offset from its seed. */
export function buildGrainTiles(factory: CanvasFactory): AnyCanvas[] {
  const rand = mulberry32(0x6a1e);
  return Array.from({ length: TILES }, () => {
    const c = factory(TILE, TILE);
    const ctx = c.getContext('2d') as Ctx2D;
    const img = ctx.createImageData(TILE, TILE);
    for (let i = 0; i < img.data.length; i += 4) {
      // Roughly gaussian (sum of uniforms), centered on mid gray.
      const v = 128 + (rand() + rand() + rand() - 1.5) * 110;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  });
}

/**
 * Grain and vignette on top of everything. Grain is seeded by `seed` (= frame mod F), so it
 * changes every frame but repeats exactly with the loop. With a transparent background both
 * only affect existing pixels (source-atop), so they never add alpha to empty areas.
 */
export function drawOverlays(
  ctx: Ctx2D,
  W: number,
  H: number,
  cfg: SceneConfig,
  seed: number,
  tiles: AnyCanvas[],
  transparentBg: boolean,
): void {
  const { grain, vignette } = cfg.overlays;
  if (vignette > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    const diag = Math.hypot(W, H) / 2;
    const g = ctx.createRadialGradient(W / 2, H / 2, diag * 0.45, W / 2, H / 2, diag * 1.05);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${(0.75 * vignette).toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  if (grain > 0 && tiles.length) {
    const rand = mulberry32(0x9e3779b9 ^ Math.imul(seed + 1, 0x85ebca6b));
    const tile = tiles[Math.floor(rand() * tiles.length)];
    const ox = Math.floor(rand() * TILE);
    const oy = Math.floor(rand() * TILE);
    const pattern = ctx.createPattern(tile, 'repeat');
    if (!pattern) return;
    ctx.save();
    ctx.globalCompositeOperation = transparentBg ? 'source-atop' : 'soft-light';
    ctx.globalAlpha = Math.min(1, grain * (transparentBg ? 0.18 : 0.45));
    ctx.translate(-ox, -oy);
    ctx.fillStyle = pattern;
    ctx.fillRect(ox, oy, W, H);
    ctx.restore();
  }
}
