import type { Background } from './index';
import { TAU, pc } from './util';

export const gradient: Background = {
  id: 'gradient',
  label: 'Degradé giratorio',
  params: [
    { key: 'mode', label: 'Tipo', min: 0, max: 1, step: 1, default: 0, options: ['Lineal', 'Radial'] },
    { key: 'cycles', label: 'Vueltas por loop', min: 1, max: 4, step: 1, default: 1 },
    { key: 'colors', label: 'Colores', min: 2, max: 5, step: 1, default: 3 },
  ],
  draw(ctx, phase, w, h, palette, p) {
    const a = TAU * p.cycles * phase;
    const diag = Math.hypot(w, h);
    let g: CanvasGradient;
    if (p.mode === 0) {
      const ux = (Math.cos(a) * diag) / 2;
      const uy = (Math.sin(a) * diag) / 2;
      g = ctx.createLinearGradient(w / 2 - ux, h / 2 - uy, w / 2 + ux, h / 2 + uy);
    } else {
      const x = w / 2 + Math.cos(a) * w * 0.28;
      const y = h / 2 + Math.sin(a) * h * 0.28;
      g = ctx.createRadialGradient(x, y, 0, x, y, diag * 0.75);
    }
    for (let i = 0; i < p.colors; i++) g.addColorStop(i / (p.colors - 1), pc(palette, i));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  },
};
