import type { Background } from './index';
import { pc } from './util';

export const solid: Background = {
  id: 'solid',
  label: 'Sólido',
  draw(ctx, _phase, w, h, palette) {
    ctx.fillStyle = pc(palette, 0);
    ctx.fillRect(0, 0, w, h);
  },
};
