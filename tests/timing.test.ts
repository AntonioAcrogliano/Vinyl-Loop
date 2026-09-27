import { describe, expect, it } from 'vitest';
import {
  TAU,
  computeTiming,
  describeLoop,
  frameState,
  loopAngle,
  loopFrames,
  loopPhase,
  loopTurns,
} from '../src/render/timing';

const RPM33 = 100 / 3;

describe('loop math', () => {
  it('matches the spec example: 33⅓ rpm, 30 fps, ~8 s', () => {
    const t = computeTiming({ fps: 30, rpm: RPM33, targetLoopSeconds: 8, introSeconds: 2.5 });
    expect(t.N).toBe(4);
    expect(t.F).toBe(216);
    expect(t.rpmEff).toBeCloseTo(RPM33, 10);
    expect(describeLoop(t)).toBe('Loop: 216 frames · 7,2 s · 4 vueltas · 33,33 rpm');
  });

  it('reproduces the one-turn reference table', () => {
    const table: [number, number, number][] = [
      [RPM33, 25, 45], [RPM33, 30, 54], [RPM33, 60, 108],
      [45, 24, 32], [45, 30, 40], [45, 60, 80],
    ];
    for (const [rpm, fps, frames] of table) expect(loopFrames(fps, rpm, 1)).toBe(frames);
  });

  it('resolves non-integer cases by adjusting rpm by a tiny amount', () => {
    for (const fps of [24, 25, 30, 60]) {
      for (const rpm of [RPM33, 45, 78, 50.5]) {
        for (const target of [1, 4, 8, 15]) {
          const t = computeTiming({ fps, rpm, targetLoopSeconds: target, introSeconds: 0 });
          expect(Number.isInteger(t.F)).toBe(true);
          expect(t.N).toBe(loopTurns(rpm, target));
          // Loop closes exactly: F frames at rpmEff = N turns.
          expect((t.F / fps) * (t.rpmEff / 60)).toBeCloseTo(t.N, 9);
          // Adjustment stays small (worst case is 78 rpm at 1 turn / 24 fps, ~2.7%).
          expect(Math.abs(t.rpmEff - rpm) / rpm).toBeLessThan(0.03);
        }
      }
    }
  });

  it('never has fewer than one turn', () => {
    expect(loopTurns(RPM33, 0.1)).toBe(1);
  });

  it('θ and φ are exactly periodic in F', () => {
    const t = computeTiming({ fps: 24, rpm: 78, targetLoopSeconds: 7, introSeconds: 2 });
    for (const i of [0, 1, 17, t.F - 1]) {
      expect(loopAngle(t, i + t.F)).toBe(loopAngle(t, i));
      expect(loopAngle(t, i + 5 * t.F)).toBe(loopAngle(t, i));
      expect(loopPhase(t, i + t.F)).toBe(loopPhase(t, i));
    }
    expect(loopPhase(t, 0)).toBe(0);
  });

  it('advances the loop at constant angular velocity ω', () => {
    const t = computeTiming({ fps: 30, rpm: 45, targetLoopSeconds: 6, introSeconds: 0 });
    expect(t.omega).toBeCloseTo((TAU * t.N) / t.F, 12);
    for (let i = 0; i < t.F; i++) {
      const d = (loopAngle(t, i + 1) - loopAngle(t, i) + TAU * 10) % TAU;
      expect(d).toBeCloseTo(t.omega % TAU, 9);
    }
  });
});

describe('intro → loop splice', () => {
  const t = computeTiming({ fps: 30, rpm: RPM33, targetLoopSeconds: 8, introSeconds: 2.5 });

  it('intro length follows the configured duration', () => {
    expect(t.I).toBe(75);
    expect(frameState(t, 0).seg).toBe('intro');
    expect(frameState(t, t.I - 1).seg).toBe('intro');
    expect(frameState(t, t.I).seg).toBe('loop');
  });

  it('starts still and inside the sleeve', () => {
    const s0 = frameState(t, 0);
    expect(s0.angle).toBe(0);
    expect(s0.move).toBe(0);
    expect(t.introAngles[1] - t.introAngles[0]).toBeLessThan(t.omega * 0.01);
  });

  it('last intro step has the loop velocity and lands on θ0', () => {
    const last = frameState(t, t.I - 1);
    const first = frameState(t, t.I);
    expect(first.angle).toBeCloseTo(t.theta0, 12);
    const step = t.introAngles[t.I] - t.introAngles[t.I - 1];
    expect(step).toBeCloseTo(t.omega, 12);
    // Angle difference across the cut equals ω (mod 2π).
    const d = (((first.angle - last.angle) % TAU) + TAU) % TAU;
    expect(d).toBeCloseTo(t.omega, 9);
    // Velocity ramps smoothly: the step before the last is almost ω too.
    expect(t.introAngles[t.I - 1] - t.introAngles[t.I - 2]).toBeCloseTo(t.omega, 3);
  });

  it('angular velocity never decreases during the intro', () => {
    for (let j = 1; j < t.I; j++) {
      const a = t.introAngles[j] - t.introAngles[j - 1];
      const b = t.introAngles[j + 1] - t.introAngles[j];
      expect(b).toBeGreaterThanOrEqual(a - 1e-12);
    }
  });

  it('pose moves linearly and reaches the loop pose exactly at the cut', () => {
    expect(frameState(t, t.I).move).toBe(1);
    expect(frameState(t, t.I - 1).move).toBeCloseTo((t.I - 1) / t.I, 12);
  });

  it('background phase runs backwards so the intro ends at φ = 0', () => {
    const last = frameState(t, t.I - 1);
    expect(last.phase).toBeCloseTo((t.F - 1) / t.F, 12);
    expect(frameState(t, t.I).phase).toBe(0);
    for (let j = 1; j <= t.I; j++) {
      const a = frameState(t, j - 1).phase;
      const b = frameState(t, j).phase;
      expect((((b - a) % 1) + 1) % 1).toBeCloseTo(1 / t.F, 12);
    }
  });

  it('with the intro disabled the timeline is just the loop', () => {
    const t0 = computeTiming({ fps: 30, rpm: 45, targetLoopSeconds: 4, introSeconds: 0 });
    expect(t0.I).toBe(0);
    expect(t0.theta0).toBe(0);
    expect(frameState(t0, 0).seg).toBe('loop');
  });
});

describe('loop → outro splice', () => {
  const t = computeTiming({ fps: 30, rpm: RPM33, targetLoopSeconds: 8, introSeconds: 2.5, outroSeconds: 2 });

  it('outro frame 0 is exactly where loop frame F would be', () => {
    expect(t.O).toBe(60);
    const o0 = frameState(t, { seg: 'outro', i: 0 });
    expect(o0.seg).toBe('outro');
    expect(o0.angle).toBe(loopAngle(t, t.F));
    expect(o0.move).toBe(1);
    expect(o0.phase).toBe(0);
  });

  it('keeps ω across the cut and slows down to rest', () => {
    const lastLoop = frameState(t, { seg: 'loop', i: t.F - 1 });
    const o0 = frameState(t, { seg: 'outro', i: 0 });
    const d = (((o0.angle - lastLoop.angle) % TAU) + TAU) % TAU;
    expect(d).toBeCloseTo(t.omega, 9);
    expect(t.outroAngles[1] - t.outroAngles[0]).toBeCloseTo(t.omega, 12);
    const endStep = t.outroAngles[t.O] - t.outroAngles[t.O - 1];
    expect(endStep).toBeLessThan(t.omega * 1e-3);
    for (let k = 1; k < t.O; k++) {
      expect(t.outroAngles[k + 1] - t.outroAngles[k]).toBeLessThanOrEqual(t.outroAngles[k] - t.outroAngles[k - 1] + 1e-12);
    }
  });

  it('ends back inside the sleeve with the phase still advancing by 1/F', () => {
    expect(frameState(t, { seg: 'outro', i: t.O - 1 }).move).toBe(0);
    for (let k = 1; k < t.O; k++) {
      const a = frameState(t, { seg: 'outro', i: k - 1 }).phase;
      const b = frameState(t, { seg: 'outro', i: k }).phase;
      expect((((b - a) % 1) + 1) % 1).toBeCloseTo(1 / t.F, 12);
    }
  });
});
