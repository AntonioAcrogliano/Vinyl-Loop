import { clamp01, easeInCubic, easeOutCubic, type FrameState, type Timing } from './timing';
import type { Ctx2D, SceneConfig, TextAnim, TextFont } from './types';

// Title card: song name + artist. During the loop it is fully visible and static (so it
// never breaks the loop); it animates in during the intro and out during the outro.

const FONTS: Record<TextFont, { family: string; title: string; artist: string }> = {
  sans: { family: '"Helvetica Neue", Helvetica, Arial, system-ui, sans-serif', title: '700', artist: '400' },
  serif: { family: 'Georgia, "Times New Roman", Times, serif', title: '700', artist: 'italic 400' },
  condensed: { family: '"Arial Narrow", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif', title: '700', artist: '400' },
  mono: { family: '"Courier New", ui-monospace, Menlo, Consolas, monospace', title: '700', artist: '400' },
};

/** Part of the intro used by the entrance (as fractions of the intro's pose `move`). */
const IN_START = 0.3;
const IN_END = 0.95;
/** Part of the outro used by the exit. */
const OUT_END = 0.6;

/**
 * Vertical space the title card needs (px), so the layout can shift the record away from it.
 * Signed: positive = text at the bottom (move the group up), negative = text at the top.
 */
export function textReserve(cfg: SceneConfig, W: number, H: number): number {
  const tx = cfg.text;
  if (!tx.enabled || (!tx.title.trim() && !tx.artist.trim())) return 0;
  const base = Math.min(W, H);
  const titleSize = base * 0.056 * tx.size;
  const h = (tx.title.trim() ? titleSize : 0) + (tx.title.trim() && tx.artist.trim() ? titleSize * 0.28 : 0) + (tx.artist.trim() ? titleSize * 0.62 : 0);
  const room = h + base * 0.045;
  return tx.position.startsWith('top') ? -room : room;
}

export interface TextPhase {
  /** 0 = hidden, 1 = fully shown. */
  e: number;
  anim: TextAnim;
  /** Leaving (outro) rather than entering. */
  out: boolean;
}

/**
 * Visibility of the title card for a frame. It is exactly 1 for every loop frame, at the end
 * of the intro and at the start of the outro, so the splices stay seamless.
 */
export function textPhase(cfg: SceneConfig, st: FrameState, t: Timing): TextPhase {
  if (st.seg === 'intro' && cfg.text.animIn !== 'none') {
    // Finish by the last intro frame at the latest, even for very short intros.
    const end = Math.min(IN_END, (t.I - 1) / t.I);
    const start = Math.min(IN_START, end * 0.5);
    return { e: easeOutCubic((st.move - start) / Math.max(1e-6, end - start)), anim: cfg.text.animIn, out: false };
  }
  if (st.seg === 'outro' && cfg.text.animOut !== 'none') {
    const q = clamp01((1 - st.move) / OUT_END);
    return { e: 1 - easeInCubic(q), anim: cfg.text.animOut, out: true };
  }
  return { e: 1, anim: 'none', out: false };
}

interface Line {
  text: string;
  font: string;
  size: number;
  y: number;
  /** Delay of this line within the animation, 0..1. */
  delay: number;
}

/** Progress of one line given the global progress and a stagger delay. */
function lineProgress(e: number, delay: number): number {
  return clamp01((e - delay) / (1 - delay));
}

export function drawTitleCard(ctx: Ctx2D, W: number, H: number, cfg: SceneConfig, st: FrameState, t: Timing, fade = 1): void {
  const tx = cfg.text;
  if (!tx.enabled || (!tx.title.trim() && !tx.artist.trim())) return;
  const { e, anim, out } = textPhase(cfg, st, t);
  if (e <= 0 || fade <= 0) return;

  const base = Math.min(W, H);
  const f = FONTS[tx.font] ?? FONTS.sans;
  const titleSize = base * 0.056 * tx.size;
  const artistSize = titleSize * 0.62;
  const gap = titleSize * 0.28;
  const margin = base * 0.065;
  const left = tx.position === 'bottomLeft' || tx.position === 'topLeft';
  const top = tx.position === 'top' || tx.position === 'topLeft';
  const title = tx.uppercase ? tx.title.toUpperCase() : tx.title;
  const artist = tx.uppercase ? tx.artist.toUpperCase() : tx.artist;

  // Stack the lines from the chosen edge.
  const lines: Line[] = [];
  const blockH = (title ? titleSize : 0) + (title && artist ? gap : 0) + (artist ? artistSize : 0);
  let y = top ? margin : H - margin - blockH;
  if (title) {
    lines.push({ text: title, font: `${f.title} ${titleSize.toFixed(2)}px ${f.family}`, size: titleSize, y: y + titleSize * 0.8, delay: 0 });
    y += titleSize + gap;
  }
  if (artist) lines.push({ text: artist, font: `${f.artist} ${artistSize.toFixed(2)}px ${f.family}`, size: artistSize, y: y + artistSize * 0.8, delay: title ? 0.18 : 0 });

  const x = left ? margin : W / 2;
  const maxW = W - margin * 2;
  ctx.save();
  ctx.textAlign = left ? 'left' : 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = tx.color;
  ctx.globalAlpha = fade;
  if (tx.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = titleSize * 0.35;
    ctx.shadowOffsetY = titleSize * 0.06;
  }

  // Typewriter reveals title then artist as one sequence of characters.
  const totalChars = lines.reduce((s, l) => s + [...l.text].length, 0);
  let charsBefore = 0;

  for (const line of lines) {
    ctx.font = line.font;
    const chars = [...line.text];
    const fullW = ctx.measureText(line.text).width;
    // Long titles shrink to fit the width.
    if (fullW > maxW) {
      const k = maxW / fullW;
      line.size *= k;
      ctx.font = line.font.replace(/[\d.]+px/, `${(parseFloat(/([\d.]+)px/.exec(line.font)![1]) * k).toFixed(2)}px`);
    }
    const width = Math.min(fullW, maxW);
    const p = lineProgress(e, line.delay);

    if (anim === 'none' || e >= 1) {
      ctx.fillText(line.text, x, line.y);
    } else if (anim === 'fade') {
      ctx.globalAlpha = (p) * fade;
      ctx.fillText(line.text, x, line.y);
    } else if (anim === 'slide') {
      ctx.globalAlpha = (p) * fade;
      ctx.fillText(line.text, x, line.y + (1 - p) * line.size * (out ? 0.9 : 1.1) * (top ? -1 : 1));
    } else if (anim === 'wipe') {
      const x0 = left ? x : x - width / 2;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0 - line.size, line.y - line.size * 1.3, (width + line.size * 2) * p, line.size * 2);
      ctx.clip();
      ctx.fillText(line.text, x, line.y);
      ctx.restore();
    } else if (anim === 'typewriter') {
      const shown = Math.floor(e * totalChars + 1e-9) - charsBefore;
      if (shown > 0) {
        const visible = chars.slice(0, Math.min(chars.length, shown)).join('');
        // Keep the final alignment: draw the prefix where it sits in the full line.
        const x0 = left ? x : x - width / 2;
        ctx.textAlign = 'left';
        ctx.fillText(visible, x0, line.y);
        ctx.textAlign = left ? 'left' : 'center';
      }
    } else if (anim === 'letters') {
      // Each letter fades and rises in turn.
      const x0 = left ? x : x - width / 2;
      const n = chars.length;
      const spread = 0.6;
      ctx.textAlign = 'left';
      let prefix = '';
      chars.forEach((c, i) => {
        const start = n > 1 ? (i / (n - 1)) * spread : 0;
        const lp = easeOutCubic(clamp01((p - start) / (1 - spread)));
        // ctx.font is already the (possibly shrunk) final font, so prefix widths match the full line.
        const cx = x0 + ctx.measureText(prefix).width;
        prefix += c;
        if (lp <= 0) return;
        ctx.globalAlpha = (lp) * fade;
        ctx.fillText(c, cx, line.y + (1 - lp) * line.size * 0.5);
      });
      ctx.textAlign = left ? 'left' : 'center';
      ctx.globalAlpha = fade;
    }
    ctx.globalAlpha = fade;
    charsBefore += chars.length;
  }
  ctx.restore();
}
