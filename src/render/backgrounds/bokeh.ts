import { mulberry32 } from '../../utils/prng';
import type { Background } from './index';
import { TAU, pc, rgba, shade } from './util';

/** Out-of-focus light discs that pulse and sway on closed paths. */
export const bokeh: Background = {
  id: 'bokeh',
  label: 'Bokeh',
  params: [
    { key: 'count', label: 'Luces', min: 4, max: 80, step: 1, default: 28 },
    { key: 'size', label: 'Tamaño', min: 0.3, max: 2.5, step: 0.05, default: 1 },
    { key: 'cycles', label: 'Pulsos por loop', min: 1, max: 4, step: 1, default: 1 },
    { key: 'blur', label: 'Desenfoque', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  draw(ctx, phase, w, h, palette, p) {
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, shade(pc(palette, 0), -0.55));
    bg.addColorStop(1, shade(pc(palette, 2), -0.6));
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    const rand = mulberry32(0xb0ce);
    const m = Math.min(w, h);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < p.count; i++) {
      const x0 = rand() * w;
      const y0 = rand() * h;
      const sway = m * (0.01 + rand() * 0.04);
      const f = 1 + Math.floor(rand() * 2);
      const ph = rand() * TAU;
      const pph = rand() * TAU;
      const r0 = m * (0.03 + rand() * 0.09) * p.size;
      const r = Math.max(1, r0 * (1 + 0.18 * Math.sin(TAU * p.cycles * phase + pph)));
      const x = x0 + Math.cos(TAU * f * phase + ph) * sway;
      const y = y0 + Math.sin(TAU * f * phase + ph) * sway * 0.5;
      const a = 0.12 + 0.22 * (0.5 + 0.5 * Math.sin(TAU * p.cycles * phase + pph + 1.3));
      const color = pc(palette, 1 + (i % Math.max(1, palette.length - 1)));
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(color, a * 0.7));
      g.addColorStop(Math.max(0.01, (1 - 0.6 * p.blur) * 0.92), rgba(color, a));
      g.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  },
};
