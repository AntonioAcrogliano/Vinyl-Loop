import { createNoise4, loopNoise } from '../../utils/noise';
import { mulberry32 } from '../../utils/prng';
import type { Background } from './index';
import { TAU, pc, rgba } from './util';

const noise = createNoise4(0xb10b);

/** Mesh-like blurred color blobs orbiting on closed (integer-frequency) Lissajous paths. */
export const blobs: Background = {
  id: 'blobs',
  label: 'Mesh / blobs',
  params: [
    { key: 'count', label: 'Manchas', min: 2, max: 10, step: 1, default: 5 },
    { key: 'cycles', label: 'Ciclos por loop', min: 1, max: 3, step: 1, default: 1 },
    { key: 'size', label: 'Tamaño', min: 0.2, max: 1, step: 0.01, default: 0.55 },
    { key: 'softness', label: 'Suavidad', min: 0, max: 1, step: 0.01, default: 0.7 },
  ],
  draw(ctx, phase, w, h, palette, p) {
    ctx.fillStyle = pc(palette, 0);
    ctx.fillRect(0, 0, w, h);
    const rand = mulberry32(0x5eed);
    const m = Math.max(w, h);
    for (let i = 0; i < p.count; i++) {
      const bx = 0.15 + rand() * 0.7;
      const by = 0.15 + rand() * 0.7;
      const rx = 0.08 + rand() * 0.18;
      const ry = 0.08 + rand() * 0.18;
      const fx = p.cycles * (1 + (i % 2));
      const fy = p.cycles * (1 + ((i + 1) % 2));
      const px = rand() * TAU;
      const py = rand() * TAU;
      const sizeJitter = 0.35 + rand() * 0.3;
      const x = (bx + rx * Math.cos(TAU * fx * phase + px)) * w;
      const y = (by + ry * Math.sin(TAU * fy * phase + py)) * h;
      // Organic breathing: 4D noise sampled on a circle, period 1 in phase.
      const r = Math.max(1, m * p.size * sizeJitter * (1 + 0.25 * loopNoise(noise, i * 1.7, 0.3, phase, 0.8)));
      const color = pc(palette, 1 + (i % Math.max(1, palette.length - 1)));
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(color, 0.9));
      g.addColorStop(1 - p.softness * 0.7, rgba(color, 0.55));
      g.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  },
};
