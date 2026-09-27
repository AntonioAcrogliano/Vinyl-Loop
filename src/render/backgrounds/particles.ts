import { mulberry32 } from '../../utils/prng';
import type { Background } from './index';
import { TAU, frac, pc, rgba } from './util';

/** Floating dust: seeded particles on small closed orbits, drifting up an integer number of screens per loop. */
export const particles: Background = {
  id: 'particles',
  label: 'Polvo / partículas',
  params: [
    { key: 'count', label: 'Partículas', min: 10, max: 500, step: 1, default: 160 },
    { key: 'size', label: 'Tamaño', min: 0.2, max: 3, step: 0.05, default: 1 },
    { key: 'drift', label: 'Subidas por loop', min: 0, max: 3, step: 1, default: 1 },
    { key: 'twinkle', label: 'Titileo', min: 0, max: 1, step: 0.01, default: 0.6 },
  ],
  draw(ctx, phase, w, h, palette, p) {
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, pc(palette, 0));
    bg.addColorStop(1, pc(palette, 2));
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    const rand = mulberry32(0xd057);
    const m = Math.min(w, h);
    for (let i = 0; i < p.count; i++) {
      const x0 = rand();
      const y0 = rand();
      const orbit = (0.005 + rand() * 0.03) * m;
      const f = 1 + Math.floor(rand() * 2);
      const dir = rand() < 0.5 ? -1 : 1;
      const ph = rand() * TAU;
      const tw = 1 + Math.floor(rand() * 3);
      const tph = rand() * TAU;
      const depth = rand(); // far particles: smaller and dimmer
      const r = Math.max(0.5, m * 0.0025 * p.size * (0.4 + depth * 1.4));
      // Vertical wrap with an integer number of screens per loop.
      const span = h + 20 * r;
      const y = frac(y0 - p.drift * phase) * span - 10 * r;
      const a = TAU * f * dir * phase + ph;
      const x = x0 * w + Math.cos(a) * orbit;
      const yy = y + Math.sin(a) * orbit * 0.6;
      const alpha = (0.35 + 0.65 * depth) * (1 - p.twinkle * (0.5 - 0.5 * Math.sin(TAU * tw * phase + tph)));
      const color = pc(palette, 1 + (i % Math.max(1, palette.length - 1)));
      const g = ctx.createRadialGradient(x, yy, 0, x, yy, r * 2.2);
      g.addColorStop(0, rgba('#ffffff', alpha));
      g.addColorStop(0.35, rgba(color, alpha * 0.8));
      g.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - r * 2.2, yy - r * 2.2, r * 4.4, r * 4.4);
    }
  },
};
