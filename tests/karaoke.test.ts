import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { cleanLines, parseLrc } from '../src/lyrics/lyrics';
import { currentLine, lineFill, lyricBlocks, openAmount, openDuration } from '../src/render/lyrics';
import { buildAssets, framesFor, renderFrame, songTimeOf, timingFor, type ExportPlan, type SongContext } from '../src/render/scene';
import { DEFAULT_CONFIG, normalizeConfig, type CanvasFactory, type Ctx2D, type SceneConfig } from '../src/render/types';

const factory: CanvasFactory = (w, h) => createCanvas(w, h) as unknown as OffscreenCanvas;
const W = 240;
const H = 180;

const LRC = `
[00:12.00]Primera línea de la canción
[00:15.00]Segunda línea
[00:18.50]Tercera línea un poco más larga que las otras
[00:40.00]Después de un solo largo
[00:43.00]Otra más
`;

function setup(open: 'slide' | 'gatefold') {
  const cfg: SceneConfig = normalizeConfig({
    ...DEFAULT_CONFIG,
    introEnabled: true,
    introSeconds: 3,
    outroEnabled: true,
    outroSeconds: 3,
    lyrics: { ...DEFAULT_CONFIG.lyrics, enabled: true, open },
  });
  const t = timingFor(cfg);
  const plan: ExportPlan = { intro: true, loops: 8, outro: true };
  const song: SongContext = { lines: cleanLines(parseLrc(LRC)), plan };
  const assets = buildAssets(cfg, { cover: null, label: null }, W, H, factory);
  const frames = framesFor(t, plan);
  const render = (k: number, withSong = true) => {
    const c = createCanvas(W, H);
    renderFrame(c.getContext('2d') as unknown as Ctx2D, frames[k], cfg, assets, withSong ? song : null);
    return new Uint8ClampedArray(c.getContext('2d').getImageData(0, 0, W, H).data);
  };
  return { cfg, t, plan, song, frames, render };
}

const same = (a: Uint8ClampedArray, b: Uint8ClampedArray) => a.every((v, i) => v === b[i]);
const meanDiff = (a: Uint8ClampedArray, b: Uint8ClampedArray) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;

describe('lyrics timing', () => {
  const lines = cleanLines(parseLrc(LRC));

  it('merges lines into blocks, splitting on long instrumental gaps', () => {
    const blocks = lyricBlocks(lines, DEFAULT_CONFIG);
    expect(blocks).toHaveLength(2);
    expect(blocks[0][0]).toBeCloseTo(12 - 1.2, 6);
    expect(blocks[1][0]).toBeCloseTo(40 - 1.2, 6);
  });

  it('opening is 0 at the window edges, 1 while singing, and changes gradually', () => {
    const cfg = DEFAULT_CONFIG;
    const blocks = lyricBlocks(lines, cfg);
    const trans = openDuration(cfg);
    expect(openAmount(blocks, 3, 3, 60, trans)).toBe(0);
    expect(openAmount(blocks, 60, 3, 60, trans)).toBe(0);
    expect(openAmount(blocks, 16, 3, 60, trans)).toBe(1);
    expect(openAmount(blocks, 30, 3, 60, trans)).toBe(0);
    let prev = 0;
    for (let t = 3; t <= 60; t += 1 / 30) {
      const v = openAmount(blocks, t, 3, 60, trans);
      // easeInOutCubic peaks at 3× the linear slope: 3 / (0.9 s · 30 fps) ≈ 0.11 per frame.
      expect(Math.abs(v - prev)).toBeLessThan(0.12);
      prev = v;
    }
  });

  it('finds the current line and fills it progressively', () => {
    expect(currentLine(lines, 5)).toBe(-1);
    expect(currentLine(lines, 16)).toBe(1);
    expect(lineFill(lines, 1, 15)).toBe(0);
    expect(lineFill(lines, 1, 16)).toBeGreaterThan(0);
    expect(lineFill(lines, 1, 18.4)).toBe(1);
  });
});

describe('karaoke rendering', () => {
  for (const open of ['slide', 'gatefold'] as const) {
    it(`${open}: frames outside the lyrics are identical to the plain video`, () => {
      const { t, frames, render, plan } = setup(open);
      // Intro, the instrumental gap, the outro.
      const gap = frames.findIndex((f) => songTimeOf(t, plan, f) >= 30);
      for (const k of [0, t.I - 1, t.I, gap, frames.length - 1]) expect(same(render(k), render(k, false))).toBe(true);
    });

    it(`${open}: frames while singing show the lyrics layout`, () => {
      const { t, frames, render, plan } = setup(open);
      const k = frames.findIndex((f) => songTimeOf(t, plan, f) >= 16);
      expect(meanDiff(render(k), render(k, false))).toBeGreaterThan(2);
    });

    it(`${open}: the transition into the lyrics has no jumps`, () => {
      const { t, frames, render, plan } = setup(open);
      const trans = open === 'gatefold' ? 2.6 : 0.9;
      const a = frames.findIndex((f) => songTimeOf(t, plan, f) >= 12 - 1.2 - trans - 0.3);
      const b = frames.findIndex((f) => songTimeOf(t, plan, f) >= 12);
      let worst = 0;
      let prev = render(a);
      for (let k = a + 1; k <= b; k += 1) {
        const cur = render(k);
        worst = Math.max(worst, meanDiff(prev, cur));
        prev = cur;
      }
      // A spinning record already changes a few units per frame; a jump would be much bigger.
      expect(worst).toBeLessThan(12);
    });

    it(`${open}: deterministic`, () => {
      const { t, frames, render, plan } = setup(open);
      const k = frames.findIndex((f) => songTimeOf(t, plan, f) >= 13.3);
      expect(same(render(k), render(k))).toBe(true);
    });
  }

  it('maps frames to song time (loop repetitions included)', () => {
    const { t, frames, plan } = setup('slide');
    frames.forEach((f, k) => {
      if (k % 97 === 0) expect(songTimeOf(t, plan, f)).toBeCloseTo(k / t.fps, 9);
    });
  });
});
