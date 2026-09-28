import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { placement } from '../src/render/layout';
import { renderThumbnail, thumbRegions, thumbSceneConfig } from '../src/render/thumbnail';
import { DEFAULT_CONFIG, DEFAULT_THUMB, normalizeConfig, type CanvasFactory, type Ctx2D, type ThumbConfig } from '../src/render/types';

const factory: CanvasFactory = (w, h) => createCanvas(w, h) as unknown as OffscreenCanvas;
const W = 640;
const H = 360;

function render(th: Partial<ThumbConfig>, photo = true) {
  const cfg = normalizeConfig({ ...DEFAULT_CONFIG, background: { ...DEFAULT_CONFIG.background, id: 'solid' } });
  const cover = createCanvas(200, 200);
  const cc = cover.getContext('2d');
  cc.fillStyle = '#2a9d8f';
  cc.fillRect(0, 0, 200, 200);
  const c = createCanvas(W, H);
  const images = { cover: photo ? (cover as unknown as ImageBitmap) : null, label: null };
  renderThumbnail(c.getContext('2d') as unknown as Ctx2D, cfg, { ...DEFAULT_THUMB, ...th }, images, factory);
  return c.getContext('2d').getImageData(0, 0, W, H).data;
}

describe('miniatura de YouTube', () => {
  it('el vinilo queda dentro de su mitad y no pisa el texto', () => {
    for (const layout of ['left', 'right', 'bottom'] as const) {
      for (const direction of ['right', 'left', 'up'] as const) {
        const cfg = normalizeConfig({ ...DEFAULT_CONFIG, direction });
        const th = { ...DEFAULT_THUMB, layout };
        const scene = thumbSceneConfig(cfg, th, W, H);
        const l = placement(scene, W, H, 1);
        const r = thumbRegions(th, W, H).record;
        const xs = [l.sleeveX - l.S / 2, l.sleeveX + l.S / 2, l.discX - l.D / 2, l.discX + l.D / 2];
        const ys = [l.sleeveY - l.S / 2, l.sleeveY + l.S / 2, l.discY - l.D / 2, l.discY + l.D / 2];
        expect(Math.min(...xs)).toBeGreaterThanOrEqual(r.x - 1);
        expect(Math.max(...xs)).toBeLessThanOrEqual(r.x + r.w + 1);
        expect(Math.min(...ys)).toBeGreaterThanOrEqual(r.y - 1);
        expect(Math.max(...ys)).toBeLessThanOrEqual(r.y + r.h + 1);
      }
    }
  });

  it('dibuja algo opaco en cada variante', () => {
    for (const th of [
      { layout: 'left' as const },
      { layout: 'right' as const, style: 'outline' as const, tag: 'Letra' },
      { layout: 'bottom' as const, style: 'band' as const },
      { layout: 'clean' as const, background: 'scene' as const, pose: 'in' as const },
    ]) {
      const px = render(th);
      // Fully opaque everywhere (no transparent holes around the record).
      let transparent = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i] < 255) transparent++;
      expect(transparent).toBe(0);
    }
    // Blur without a photo falls back to a dark backdrop.
    const px = render({}, false);
    expect(px[3]).toBe(255);
  });

  it('el texto cambia la imagen del lado del texto', () => {
    const a = render({ title: 'Un título', artist: 'Alguien', scrim: 0 });
    const b = render({ layout: 'clean', scrim: 0 });
    let diffLeft = 0;
    for (let y = 0; y < H; y += 4) for (let x = 0; x < W * 0.45; x += 4) if (a[(y * W + x) * 4] !== b[(y * W + x) * 4]) diffLeft++;
    expect(diffLeft).toBeGreaterThan(50);
  });
});
