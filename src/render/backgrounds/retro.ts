import type { Background } from './index';
import { frac, pc, rgba } from './util';

/** Synthwave perspective grid or VHS scanlines, both scrolling an integer number of steps per loop. */
export const retro: Background = {
  id: 'retro',
  label: 'Retro / VHS',
  params: [
    { key: 'mode', label: 'Estilo', min: 0, max: 1, step: 1, default: 0, options: ['Grilla', 'Scanlines'] },
    { key: 'speed', label: 'Pasos por loop', min: 1, max: 12, step: 1, default: 4 },
    { key: 'sun', label: 'Sol', min: 0, max: 1, step: 1, default: 1, options: ['No', 'Sí'] },
  ],
  draw(ctx, phase, w, h, palette, p) {
    const o = frac(p.speed * phase);
    if (p.mode === 1) {
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, pc(palette, 0));
      bg.addColorStop(1, pc(palette, 2));
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      const gap = Math.max(2, h / 180);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      for (let y = (o - 1) * gap * 2; y < h; y += gap * 2) ctx.fillRect(0, y, w, gap);
      // Rolling bright band, one pass per loop.
      const by = frac(phase) * (h * 1.4) - h * 0.2;
      const band = ctx.createLinearGradient(0, by - h * 0.12, 0, by + h * 0.12);
      band.addColorStop(0, 'rgba(255,255,255,0)');
      band.addColorStop(0.5, 'rgba(255,255,255,0.10)');
      band.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = band;
      ctx.fillRect(0, by - h * 0.12, w, h * 0.24);
      return;
    }

    const horizon = h * 0.56;
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, pc(palette, 2));
    sky.addColorStop(1, pc(palette, 1));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, horizon);
    if (p.sun) {
      const r = Math.min(w, h) * 0.22;
      const sx = w / 2;
      const sy = horizon - r * 0.35;
      const sg = ctx.createLinearGradient(0, sy - r, 0, sy + r);
      sg.addColorStop(0, pc(palette, 3));
      sg.addColorStop(1, pc(palette, 1));
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, horizon);
      ctx.clip();
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
      // Horizontal cuts across the lower half of the sun, scrolling down one slot per step.
      ctx.fillStyle = pc(palette, 1);
      const slot = r * 0.16;
      for (let k = -1; k < 7; k++) {
        const t = (k + o) / 7;
        if (t < 0) continue;
        ctx.fillRect(sx - r, sy + (k + o) * slot, r * 2, slot * 0.5 * t);
      }
      ctx.restore();
    }
    const ground = ctx.createLinearGradient(0, horizon, 0, h);
    ground.addColorStop(0, pc(palette, 0));
    ground.addColorStop(1, pc(palette, 2));
    ctx.fillStyle = ground;
    ctx.fillRect(0, horizon, w, h - horizon);

    const line = pc(palette, 4);
    ctx.lineWidth = Math.max(1, h * 0.0025);
    // Horizontal lines at depth z = k + 1 - o: shifting by one line maps the set onto itself,
    // and far lines fade out near the horizon so nothing pops.
    const depth = h - horizon;
    for (let k = 0; k < 40; k++) {
      const z = k + 1 - o;
      if (z <= 0.02) continue;
      const y = horizon + (depth * 0.35) / z;
      if (y > h + 4) continue;
      const fade = Math.min(1, Math.max(0, (40 - z) / 30));
      ctx.strokeStyle = rgba(line, Math.min(1, 1.2 / (0.4 + z * 0.35)) * fade);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.strokeStyle = rgba(line, 0.8);
    for (let i = -20; i <= 20; i++) {
      ctx.beginPath();
      ctx.moveTo(w / 2 + i * w * 0.01, horizon);
      ctx.lineTo(w / 2 + i * w * 0.14, h);
      ctx.stroke();
    }
    const glow = ctx.createLinearGradient(0, horizon - h * 0.04, 0, horizon + h * 0.04);
    glow.addColorStop(0, rgba(line, 0));
    glow.addColorStop(0.5, rgba(line, 0.5));
    glow.addColorStop(1, rgba(line, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, horizon - h * 0.04, w, h * 0.08);
  },
};
