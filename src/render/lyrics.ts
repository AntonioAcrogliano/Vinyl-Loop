import { lineEnd, type LyricLine } from '../lyrics/lyrics';
import { clamp01, easeInOutCubic } from './timing';
import type { Ctx2D, SceneConfig, TextFont } from './types';

// Karaoke: when lyrics are being sung the record makes room (slides aside or opens like a
// gatefold) and a scrolling list shows the lines, filling the current one as it is sung.
// Everything here is a pure function of the song time, so exports stay deterministic.

const FONTS: Record<TextFont, string> = {
  sans: '"Helvetica Neue", Helvetica, Arial, system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", Times, serif',
  condensed: '"Arial Narrow", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif',
  mono: '"Courier New", ui-monospace, Menlo, Consolas, monospace',
};

/** Seconds the record needs to move aside (slide) or open (gatefold). */
export function openDuration(cfg: SceneConfig): number {
  return cfg.lyrics.open === 'gatefold' ? 2.6 : 0.9;
}

/** Lead before the first line of a block, and hold after its last line (s). */
const LEAD = 1.2;
const HOLD = 1.5;

/**
 * Time ranges (song seconds) during which the lyrics are shown: lines closer than
 * cfg.lyrics.gap are merged, so the record only goes back to the center in real gaps.
 */
export function lyricBlocks(lines: LyricLine[], cfg: SceneConfig): [number, number][] {
  const off = cfg.lyrics.offset;
  const blocks: [number, number][] = [];
  lines.forEach((l, i) => {
    const s = l.start + off - LEAD;
    const e = lineEnd(lines, i) + off + HOLD;
    const last = blocks[blocks.length - 1];
    if (last && s - last[1] < cfg.lyrics.gap) last[1] = Math.max(last[1], e);
    else blocks.push([s, e]);
  });
  return blocks;
}

/**
 * How open the layout is at song time `t` (0 = normal scene, 1 = lyrics layout), eased.
 * It is exactly 0 outside (lo, hi) — the loop part of the song — so the intro and outro
 * are untouched and the splices stay seamless.
 */
export function openAmount(blocks: [number, number][], t: number, lo: number, hi: number, trans: number, raw = false): number {
  let v = 0;
  for (const [s0, e0] of blocks) {
    // Keep the whole transition inside the window.
    const s = Math.max(s0, lo + trans);
    const e = Math.min(e0, hi - trans);
    if (e <= s) continue;
    const up = clamp01((t - (s - trans)) / trans);
    const down = clamp01((e + trans - t) / trans);
    v = Math.max(v, Math.min(up, down));
  }
  // raw: the linear ramp, for animations that apply their own easing per phase.
  return raw ? v : easeInOutCubic(v);
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function isPortrait(W: number, H: number): boolean {
  return H > W * 1.15;
}

/** Where the record goes when sliding aside: left half (or top half in portrait). */
export function slideRegion(W: number, H: number): { record: Rect; lyrics: Rect } {
  if (isPortrait(W, H)) {
    return {
      record: { x: 0, y: 0, w: W, h: H * 0.47 },
      lyrics: { x: W * 0.08, y: H * 0.5, w: W * 0.84, h: H * 0.44 },
    };
  }
  return {
    record: { x: 0, y: 0, w: W * 0.5, h: H },
    lyrics: { x: W * 0.53, y: H * 0.1, w: W * 0.41, h: H * 0.8 },
  };
}

// ---------- List drawing ----------

interface Wrapped {
  /** Rows of each line (word-wrapped to the width). */
  rows: string[][];
  /** Cumulative top of each line, relative to line 0. */
  tops: number[];
  heights: number[];
}

const wrapCache = new WeakMap<LyricLine[], Map<string, Wrapped>>();

function wrap(ctx: Ctx2D, lines: LyricLine[], font: string, width: number, rowH: number, gapH: number): Wrapped {
  const key = `${font}|${Math.round(width)}|${rowH.toFixed(2)}`;
  let byKey = wrapCache.get(lines);
  if (!byKey) wrapCache.set(lines, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit) return hit;
  ctx.font = font;
  const rows: string[][] = [];
  const tops: number[] = [];
  const heights: number[] = [];
  let y = 0;
  for (const l of lines) {
    const words = l.text.split(/\s+/);
    const out: string[] = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (cur && ctx.measureText(next).width > width) {
        out.push(cur);
        cur = w;
      } else cur = next;
    }
    if (cur) out.push(cur);
    rows.push(out);
    tops.push(y);
    const h = out.length * rowH;
    heights.push(h);
    y += h + gapH;
  }
  const res = { rows, tops, heights };
  byKey.set(key, res);
  return res;
}

/** Index of the line being sung at time t (or the last one sung); -1 before the first. */
export function currentLine(lines: LyricLine[], t: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].start <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** 0..1 of the line already sung, by characters (word timings when available). */
export function lineFill(lines: LyricLine[], i: number, t: number): number {
  const l = lines[i];
  const total = l.text.length || 1;
  if (l.words?.length) {
    let chars = 0;
    for (const w of l.words) {
      if (t >= w.end) chars += w.text.length + 1;
      else if (t > w.start) {
        chars += (w.text.length + 1) * clamp01((t - w.start) / Math.max(0.05, w.end - w.start));
        break;
      } else break;
    }
    return clamp01(chars / total);
  }
  const end = lineEnd(lines, i);
  return clamp01((t - l.start) / Math.max(0.2, end - l.start));
}

/**
 * Scrolling karaoke list inside `rect`: the current line sits a bit above the middle, fully
 * opaque and filling with the highlight color; the others fade with distance.
 */
export function drawLyricsList(ctx: Ctx2D, rect: Rect, lines: LyricLine[], songT: number, cfg: SceneConfig, alpha: number, base: number): void {
  if (alpha <= 0 || !lines.length) return;
  const L = cfg.lyrics;
  const t = songT - L.offset;
  // Sized to the canvas, but never too big for the lyrics column.
  const size = Math.min(base * 0.05, rect.w * 0.085) * L.size;
  const rowH = size * 1.22;
  const gapH = size * 0.55;
  const font = `700 ${size.toFixed(2)}px ${FONTS[L.font] ?? FONTS.sans}`;
  const layout = wrap(ctx, lines, font, rect.w, rowH, gapH);

  // Smooth scroll: glide from the previous line to the current one when it starts.
  const cur = currentLine(lines, t);
  const idx = Math.max(0, cur);
  const glide = cur >= 0 ? easeInOutCubic(clamp01((t - lines[cur].start) / 0.45)) : 1;
  const center = (i: number) => layout.tops[i] + layout.heights[i] / 2;
  const from = cur > 0 ? center(cur - 1) : center(idx);
  const focusY = rect.y + rect.h * 0.42;
  const scroll = from + (center(idx) - from) * glide;

  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x - size, rect.y, rect.w + size * 2, rect.h);
  ctx.clip();
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const xFor = (row: string) => (L.align === 'center' ? rect.x + (rect.w - ctx.measureText(row).width) / 2 : rect.x);

  for (let i = 0; i < lines.length; i++) {
    const top = focusY + layout.tops[i] - scroll;
    if (top > rect.y + rect.h || top + layout.heights[i] < rect.y) continue;
    const dist = Math.abs(center(i) - scroll) / (rect.h * 0.5);
    const active = i === cur;
    const a = alpha * (active ? 1 : Math.max(0.12, 0.55 - dist * 0.45));
    const rows = layout.rows[i];
    // Karaoke fill across the wrapped rows, by characters.
    const fill = active ? lineFill(lines, i, t) : i < cur ? 1 : 0;
    const totalChars = rows.reduce((s, r) => s + r.length, 0) || 1;
    let charsLeft = fill * totalChars;
    rows.forEach((row, r) => {
      const y = top + r * rowH + rowH / 2;
      const x = xFor(row);
      ctx.globalAlpha = a;
      ctx.fillStyle = L.color;
      ctx.fillText(row, x, y);
      if (active && charsLeft > 0) {
        const n = Math.min(row.length, charsLeft);
        const whole = Math.floor(n);
        const partW = ctx.measureText(row.slice(0, whole)).width + (whole < row.length ? (n - whole) * ctx.measureText(row[whole]).width : 0);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x - 1, y - rowH / 2, partW + 1, rowH);
        ctx.clip();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = L.highlight;
        ctx.fillText(row, x, y);
        ctx.restore();
      }
      charsLeft -= row.length;
    });
  }
  ctx.restore();
}
