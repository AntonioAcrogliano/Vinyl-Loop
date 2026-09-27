import { loadImage } from '@napi-rs/canvas';
import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { encodePng } from '../src/utils/png';

describe('PNG encoder', () => {
  it('round-trips RGBA with real alpha', async () => {
    const W = 37;
    const H = 23;
    const px = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        px[o] = (x * 7) & 255;
        px[o + 1] = (y * 11) & 255;
        px[o + 2] = (x * y) & 255;
        // Mix of fully transparent, fully opaque and partial alpha. Keep color = 0 where
        // alpha = 0, since canvases don't preserve color under zero alpha.
        const a = x < 5 ? 0 : x > 30 ? 255 : 128;
        px[o + 3] = a;
        if (a === 0) px[o] = px[o + 1] = px[o + 2] = 0;
        if (a === 128) px[o] = px[o + 1] = px[o + 2] = 128;
      }
    }
    const png = encodePng(px, W, H);
    const img = await loadImage(Buffer.from(png));
    expect([img.width, img.height]).toEqual([W, H]);
    const ctx = createCanvas(W, H).getContext('2d');
    ctx.drawImage(img, 0, 0);
    const back = ctx.getImageData(0, 0, W, H).data;
    let maxDiff = 0;
    for (let i = 0; i < px.length; i++) maxDiff = Math.max(maxDiff, Math.abs(back[i] - px[i]));
    expect(maxDiff).toBeLessThanOrEqual(1); // premultiplication rounding only
    expect(back[3]).toBe(0);
    expect(back[(W - 1) * 4 + 3]).toBe(255);
  });
});
