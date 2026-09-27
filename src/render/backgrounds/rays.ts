import type { Background } from './index';
import { TAU, pc, rgba } from './util';

export const rays: Background = {
  id: 'rays',
  label: 'Rayos',
  params: [
    { key: 'rays', label: 'Rayos', min: 6, max: 48, step: 2, default: 18 },
    { key: 'speed', label: 'Rayos por loop', min: -12, max: 12, step: 1, default: 2 },
    { key: 'glow', label: 'Resplandor', min: 0, max: 1, step: 0.01, default: 0.6 },
  ],
  draw(ctx, phase, w, h, palette, p) {
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.hypot(w, h);
    const n = Math.max(2, p.rays);
    const wedge = TAU / n;
    // Advancing an integer number of ray pairs per loop maps the pattern onto itself.
    const off = p.speed * 2 * wedge * phase;
    ctx.fillStyle = pc(palette, 0);
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = pc(palette, 1);
    ctx.beginPath();
    for (let i = 0; i < n; i += 2) {
      const a0 = off + i * wedge;
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, a0, a0 + wedge);
      ctx.closePath();
    }
    ctx.fill();
    if (p.glow > 0) {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w, h) * 0.7);
      g.addColorStop(0, rgba(pc(palette, 3), 0.85 * p.glow));
      g.addColorStop(1, rgba(pc(palette, 3), 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      const v = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.3, cx, cy, R * 0.6);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, `rgba(0,0,0,${(0.35 * p.glow).toFixed(3)})`);
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, w, h);
    }
  },
};
