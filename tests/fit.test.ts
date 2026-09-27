import { describe, expect, it } from 'vitest';
import { framesFor, timingFor } from '../src/render/scene';
import { DEFAULT_CONFIG, normalizeConfig } from '../src/render/types';
import { fitToDuration, formatDuration, parseDuration } from '../src/utils/fit';

describe('fit to song duration', () => {
  const cases: [number, number, number][] = [
    // duration (s), fps, rpm
    [222, 30, 100 / 3],
    [185.37, 24, 45],
    [61, 60, 78],
    [420, 25, 100 / 3],
    [30, 30, 100 / 3],
  ];
  for (const [dur, fps, rpm] of cases) {
    it(`${formatDuration(dur)} at ${fps} fps, ${rpm.toFixed(1)} rpm lasts exactly the song`, () => {
      const cfg = normalizeConfig({ ...DEFAULT_CONFIG, fps, rpm });
      const fit = fitToDuration(dur, cfg)!;
      expect(fit).not.toBeNull();
      // Apply it the way the app does and count the real exported frames.
      const applied = normalizeConfig({ ...cfg, introEnabled: true, outroEnabled: true, introSeconds: fit.introSeconds, outroSeconds: fit.outroSeconds });
      const t = timingFor(applied);
      expect(t.I).toBe(fit.introFrames);
      expect(t.O).toBe(fit.outroFrames);
      const frames = framesFor(t, { intro: true, loops: fit.loops, outro: true });
      expect(frames.length).toBe(Math.round(dur * fps));
      expect(fit.introSeconds).toBeGreaterThanOrEqual(1);
      expect(fit.outroSeconds).toBeGreaterThanOrEqual(1);
      expect(fit.introSeconds).toBeLessThanOrEqual(12);
      expect(fit.outroSeconds).toBeLessThanOrEqual(12);
      expect(fit.loops).toBeGreaterThanOrEqual(1);
    });
  }

  it('keeps the intro/outro ratio close to the current settings', () => {
    const cfg = normalizeConfig({ ...DEFAULT_CONFIG, introEnabled: true, introSeconds: 4, outroEnabled: true, outroSeconds: 2 });
    const fit = fitToDuration(200, cfg)!;
    expect(fit.introSeconds).toBeGreaterThan(fit.outroSeconds);
  });

  it('rejects songs shorter than one loop plus a minimal intro and outro', () => {
    expect(fitToDuration(5, DEFAULT_CONFIG)).toBeNull();
    expect(fitToDuration(0, DEFAULT_CONFIG)).toBeNull();
  });
});

describe('duration text', () => {
  it('parses m:ss, h:mm:ss and plain seconds', () => {
    expect(parseDuration('3:42')).toBe(222);
    expect(parseDuration('1:02:03')).toBe(3723);
    expect(parseDuration('185,5')).toBe(185.5);
    expect(parseDuration('abc')).toBeNull();
    expect(parseDuration('')).toBeNull();
  });
  it('formats seconds', () => {
    expect(formatDuration(222)).toBe('3:42');
    expect(formatDuration(65.5)).toBe('1:05.5');
  });
});
