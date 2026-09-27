import { createCanvas, type Canvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { BACKGROUNDS, resolveParams, type Background } from '../src/render/backgrounds';
import { LABEL_PRESETS, drawLabelPreset } from '../src/render/labels';
import { placement } from '../src/render/layout';
import { buildAssets, framesFor, planTag, renderFrame, timingFor } from '../src/render/scene';
import { textPhase } from '../src/render/text';
import { frameState, type FrameRef } from '../src/render/timing';
import {
  DEFAULT_CONFIG,
  normalizeConfig,
  type CanvasFactory,
  type Ctx2D,
  type ImageLike,
  type SceneAssets,
  type SceneConfig,
} from '../src/render/types';

const factory: CanvasFactory = (w, h) => createCanvas(w, h) as unknown as OffscreenCanvas;

/** Synthetic, asymmetric test photo so any rotation error shows up in the label. */
function testPhoto(): ImageLike {
  const c = createCanvas(300, 200);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 300, 200);
  g.addColorStop(0, '#ff2d55');
  g.addColorStop(1, '#1e90ff');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 300, 200);
  ctx.fillStyle = '#ffe600';
  ctx.fillRect(150, 60, 70, 25);
  ctx.fillStyle = '#00c26e';
  ctx.beginPath();
  ctx.arc(110, 130, 30, 0, Math.PI * 2);
  ctx.fill();
  return c as unknown as ImageLike;
}

const W = 256;
const H = 192;
const photo = testPhoto();
const assetCache = new Map<SceneConfig, SceneAssets>();

function render(cfg: SceneConfig, frame: number | FrameRef): Uint8ClampedArray {
  let assets = assetCache.get(cfg);
  if (!assets) {
    assets = buildAssets(cfg, { cover: photo, label: null }, W, H, factory);
    assetCache.set(cfg, assets);
  }
  const canvas: Canvas = createCanvas(W, H);
  renderFrame(canvas.getContext('2d') as unknown as Ctx2D, frame, cfg, assets);
  return new Uint8ClampedArray(canvas.getContext('2d').getImageData(0, 0, W, H).data);
}

function diffCount(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let n = 0;
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) n++;
  return n;
}

function meanAbsDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let s = 0;
  for (let k = 0; k < a.length; k++) s += Math.abs(a[k] - b[k]);
  return s / a.length;
}

const PALETTE = ['#e9e4da', '#c8322d', '#1d3557', '#f1c453', '#2a9d8f'];

function cfgWith(bg: Background, patch: Partial<SceneConfig>, params: Record<string, number> = {}): SceneConfig {
  return normalizeConfig({
    ...DEFAULT_CONFIG,
    outroEnabled: true,
    ...patch,
    background: { id: bg.id, palette: PALETTE, paletteFromPhoto: false, params },
  });
}

const variants: [string, Partial<SceneConfig>][] = [
  ['default', {}],
  ['left, 45 rpm, 24 fps, grain + vignette', { direction: 'left', rpm: 45, fps: 24, overlays: { grain: 0.8, vignette: 0.6 } }],
  ['up, 78 rpm, no intro, wobble', { direction: 'up', rpm: 78, introEnabled: false, vinyl: { ...DEFAULT_CONFIG.vinyl, wobble: 1 } }],
  ['side layout, color vinyl, 60 fps', { layout: 'side', discOut: 0.88, rpm: 50.5, fps: 60, targetLoopSeconds: 5, vinyl: { ...DEFAULT_CONFIG.vinyl, style: 'color' } }],
  ['solo layout, translucent, wear + paper', {
    layout: 'solo',
    vinyl: { ...DEFAULT_CONFIG.vinyl, style: 'translucent', wobble: 0.5 },
    sleeve: { ...DEFAULT_CONFIG.sleeve, wear: 1, innerSleeve: true },
    overlays: { grain: 0.5, vignette: 0.5 },
  }],
  ['title card (letters in, slide out), 24 fps, short intro', {
    fps: 24,
    introSeconds: 0.5,
    text: { ...DEFAULT_CONFIG.text, enabled: true, animIn: 'letters', animOut: 'slide', position: 'topLeft' },
  }],
  ['title card typewriter, bottom, serif', {
    text: { ...DEFAULT_CONFIG.text, enabled: true, animIn: 'typewriter', animOut: 'wipe', font: 'serif', uppercase: true },
  }],
  ['die-cut kraft sleeve, standard label, outro', {
    sleeve: { ...DEFAULT_CONFIG.sleeve, style: 'dieCut', material: 'kraft' },
    label: { ...DEFAULT_CONFIG.label, source: 'preset', preset: 'sunburst' },
  }],
];

describe('loop test: frame 0 and virtual frame F are pixel-identical', () => {
  for (const bg of BACKGROUNDS) {
    for (const [name, patch] of variants) {
      it(`${bg.id} · ${name}`, () => {
        const cfg = cfgWith(bg, patch);
        const t = timingFor(cfg);
        const first = render(cfg, t.I);
        expect(diffCount(first, render(cfg, t.I + t.F))).toBe(0);
        expect(diffCount(first, render(cfg, { seg: 'loop', i: 3 * t.F }))).toBe(0);
        // Sanity: the next frame really is different (the disc moves).
        expect(diffCount(first, render(cfg, t.I + 1))).toBeGreaterThan(0);
      });
    }
  }
});

/**
 * The strong check: a background whose motion isn't an integer number of cycles per loop
 * still gives frame F == frame 0 (phase wraps to 0), but jumps between F-1 and F. So the
 * wrap step must look like any other step.
 */
describe('background continuity across the loop point', () => {
  const F = 90;
  const drawBg = (bg: Background, params: Record<string, number>, phase: number) => {
    const c = createCanvas(W, H);
    bg.draw(c.getContext('2d') as unknown as Ctx2D, phase, W, H, PALETTE, resolveParams(bg, params));
    return new Uint8ClampedArray(c.getContext('2d').getImageData(0, 0, W, H).data);
  };
  const wrapIsSmooth = (bg: Background, params: Record<string, number>) => {
    const frames = [-2, -1, 0, 1, 2].map((k) => drawBg(bg, params, (((k % F) + F) % F) / F));
    const steps = [0, 1, 2, 3].map((k) => meanAbsDiff(frames[k], frames[k + 1]));
    const wrap = steps[1]; // (F-1) → 0
    const typical = Math.max(steps[0], steps[2], steps[3]);
    return wrap <= typical * 2 + 0.05;
  };

  it('control: a non-integer cycle count is detected', () => {
    const broken: Background = {
      id: 'broken',
      label: 'broken',
      draw(ctx, phase, w, h) {
        const a = Math.PI * 2 * 1.5 * phase;
        const g = ctx.createLinearGradient(0, 0, w * Math.cos(a), h * Math.sin(a));
        g.addColorStop(0, '#000000');
        g.addColorStop(1, '#ffffff');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      },
    };
    expect(wrapIsSmooth(broken, {})).toBe(false);
  });

  for (const bg of BACKGROUNDS) {
    const modes = bg.params?.find((p) => p.options && p.key === 'mode');
    const variantsOf = modes ? modes.options!.map((_, m) => ({ mode: m })) : [{}];
    for (const params of variantsOf) {
      it(`${bg.id} ${JSON.stringify(params)}`, () => {
        expect(wrapIsSmooth(bg, params)).toBe(true);
      });
    }
  }
});

describe('splice tests', () => {
  const noGrain = (c: SceneConfig) => ({ ...c, overlays: { grain: 0, vignette: c.overlays.vignette } });
  for (const layout of ['semi', 'side', 'solo'] as const) {
    it(`intro → loop has no visible jump (${layout})`, () => {
      const cfg = noGrain(cfgWith(BACKGROUNDS[3], { layout, discOut: layout === 'side' ? 0.88 : 0.5 }));
      const t = timingFor(cfg);
      const cut = meanAbsDiff(render(cfg, t.I - 1), render(cfg, t.I));
      const step = meanAbsDiff(render(cfg, t.I), render(cfg, t.I + 1));
      expect(cut).toBeLessThan(step * 1.5 + 0.02);
    });

    it(`loop → outro has no visible jump (${layout})`, () => {
      const cfg = noGrain(cfgWith(BACKGROUNDS[3], { layout, discOut: layout === 'side' ? 0.88 : 0.5 }));
      const t = timingFor(cfg);
      const cut = meanAbsDiff(render(cfg, { seg: 'loop', i: t.F - 1 }), render(cfg, { seg: 'outro', i: 0 }));
      const step = meanAbsDiff(render(cfg, { seg: 'loop', i: 0 }), render(cfg, { seg: 'loop', i: 1 }));
      expect(cut).toBeLessThan(step * 1.5 + 0.02);
      // Outro frame 0 is pixel-identical to loop frame 0 (= loop frame F).
      expect(diffCount(render(cfg, { seg: 'outro', i: 0 }), render(cfg, { seg: 'loop', i: 0 }))).toBe(0);
    });
  }

  it('intro state lands exactly on the loop state', () => {
    const t = timingFor(DEFAULT_CONFIG);
    const last = frameState(t, t.I - 1);
    const first = frameState(t, t.I);
    expect(t.introAngles[t.I] % (2 * Math.PI)).toBeCloseTo(first.angle, 12);
    expect(first.move).toBe(1);
    expect(first.phase).toBe(0);
    expect(first.angle - last.angle + (first.angle < last.angle ? 2 * Math.PI : 0)).toBeCloseTo(t.omega, 9);
    expect((first.phase - last.phase + 1) % 1).toBeCloseTo(1 / t.F, 12);
  });

  it('solo layout: the loop shows no sleeve and the intro starts with the disc hidden', () => {
    const bg = BACKGROUNDS[1];
    const solo = cfgWith(bg, { layout: 'solo', shadow: 0 });
    const t = timingFor(solo);
    // Loop frame: rendering without sleeve assets must not change a pixel.
    const loop = render(solo, t.I);
    const assets = buildAssets(solo, { cover: photo, label: null }, W, H, factory);
    const blank = createCanvas(4, 4) as unknown as OffscreenCanvas;
    const c = createCanvas(W, H);
    renderFrame(c.getContext('2d') as unknown as Ctx2D, t.I, solo, { ...assets, sleeve: blank, paper: null });
    expect(diffCount(loop, new Uint8ClampedArray(c.getContext('2d').getImageData(0, 0, W, H).data))).toBe(0);
  });
});

describe('export plans', () => {
  const t = timingFor({ ...DEFAULT_CONFIG, outroEnabled: true });

  it('never include the duplicated frame F', () => {
    const loop = framesFor(t, { intro: false, loops: 1, outro: false });
    expect(loop.length).toBe(t.F);
    expect(loop[loop.length - 1]).toEqual({ seg: 'loop', i: t.F - 1 });
  });

  it('concatenate intro, N loops and outro', () => {
    const all = framesFor(t, { intro: true, loops: 3, outro: true });
    expect(all.length).toBe(t.I + 3 * t.F + t.O);
    expect(all[0]).toEqual({ seg: 'intro', i: 0 });
    expect(all[t.I]).toEqual({ seg: 'loop', i: 0 });
    expect(all[all.length - 1]).toEqual({ seg: 'outro', i: t.O - 1 });
    expect(planTag({ intro: true, loops: 3, outro: true })).toBe('intro-loopx3-outro');
    expect(planTag({ intro: true, loops: 1, outro: false })).toBe('intro-loop');
    expect(planTag({ intro: false, loops: 0, outro: true })).toBe('outro');
  });
});

describe('determinism', () => {
  it('rendering the same frame twice gives identical pixels', () => {
    const cfg = cfgWith(BACKGROUNDS[3], { overlays: { grain: 1, vignette: 0.5 } });
    expect(diffCount(render(cfg, 37), render(cfg, 37))).toBe(0);
    expect(diffCount(render(cfg, { seg: 'outro', i: 12 }), render(cfg, { seg: 'outro', i: 12 }))).toBe(0);
  });
});

describe('die-cut sleeve and standard labels', () => {
  const bg = BACKGROUNDS[1];

  it('the label shows through the hole while the disc is inside', () => {
    const cfg = cfgWith(bg, {
      shadow: 0,
      sleeve: { ...DEFAULT_CONFIG.sleeve, style: 'dieCut', material: 'kraft' },
      label: { ...DEFAULT_CONFIG.label, source: 'preset', preset: 'minimal', color: '#00ff00', title: '', subtitle: '' },
    });
    const px = render(cfg, { seg: 'intro', i: 0 });
    const l = placement(cfg, W, H, 0);
    // Halfway between the spindle hole and the label edge, the minimal label is flat green.
    const r = (l.D * cfg.vinyl.labelSize) / 2;
    const x = Math.round(l.sleeveX + r * 0.55);
    const y = Math.round(l.sleeveY);
    const o = (y * W + x) * 4;
    expect(px[o + 1]).toBeGreaterThan(200);
    expect(px[o]).toBeLessThan(60);
    // A full cover hides it.
    const full = render({ ...cfg, sleeve: { ...cfg.sleeve, style: 'full' } }, { seg: 'intro', i: 0 });
    expect(full[o + 1]).toBeLessThan(200);
  });

  it('every standard label renders and they all look different', () => {
    const sigs = LABEL_PRESETS.map((p) => {
      const c = createCanvas(64, 64);
      const ctx = c.getContext('2d') as unknown as Ctx2D;
      drawLabelPreset(ctx, 32, 32, 30, p.id, '', { title: 'Título', subtitle: 'Artista', rpm: '33⅓ RPM' });
      return Array.from(c.getContext('2d').getImageData(0, 0, 64, 64).data.filter((_, i) => i % 97 === 0)).join();
    });
    expect(new Set(sigs).size).toBe(LABEL_PRESETS.length);
  });

  it('old presets with useSeparateLabel migrate to label.source = image', () => {
    const migrated = normalizeConfig({ useSeparateLabel: true } as Partial<SceneConfig>);
    expect(migrated.label.source).toBe('image');
    expect('useSeparateLabel' in migrated).toBe(false);
  });
});

describe('title card timing', () => {
  it('is fully visible through the loop and at both splices, for every animation', () => {
    for (const anim of ['fade', 'slide', 'wipe', 'typewriter', 'letters'] as const) {
      for (const [fps, intro] of [[24, 0.5], [30, 2.5], [60, 1]] as const) {
        const cfg = normalizeConfig({ ...DEFAULT_CONFIG, fps, introSeconds: intro, outroEnabled: true, text: { ...DEFAULT_CONFIG.text, enabled: true, animIn: anim, animOut: anim } });
        const t = timingFor(cfg);
        expect(textPhase(cfg, frameState(t, t.I - 1), t).e).toBe(1);
        expect(textPhase(cfg, frameState(t, { seg: 'loop', i: 7 }), t).e).toBe(1);
        expect(textPhase(cfg, frameState(t, { seg: 'outro', i: 0 }), t).e).toBe(1);
        expect(textPhase(cfg, frameState(t, { seg: 'intro', i: 0 }), t).e).toBe(0);
        expect(textPhase(cfg, frameState(t, { seg: 'outro', i: t.O - 1 }), t).e).toBe(0);
      }
    }
  });

  it('the text is really drawn (pixels change when enabled)', () => {
    const base = cfgWith(BACKGROUNDS[1], {});
    const withText = cfgWith(BACKGROUNDS[1], { text: { ...DEFAULT_CONFIG.text, enabled: true, color: '#ff00ff' } });
    const t = timingFor(base);
    expect(diffCount(render(base, t.I + 3), render(withText, t.I + 3))).toBeGreaterThan(200);
  });
});
