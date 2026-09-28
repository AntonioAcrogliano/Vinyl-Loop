// Loop math. Everything here is pure and deterministic.
//
// Frames are addressed either by a FrameRef ({ seg, i }) or by a timeline number:
//   frameIndex in [0, I)        → intro frame j = frameIndex
//   frameIndex >= I             → loop frame i = frameIndex - I (unbounded; wraps every F frames)
// The outro is only reachable through a FrameRef ({ seg: 'outro', i }), since the loop is endless.
// With intro disabled, I = 0 and the timeline is just the loop.

export const TAU = Math.PI * 2;

export interface TimingInput {
  fps: number;
  rpm: number;
  targetLoopSeconds: number;
  introSeconds: number;
  outroSeconds?: number;
}

export interface Timing {
  fps: number;
  /** Turns completed in one loop. */
  N: number;
  /** Frames in one loop (frame F == frame 0, so it is never exported). */
  F: number;
  /** Frames in the intro. */
  I: number;
  /** Frames in the outro. */
  O: number;
  /** Effective rpm, adjusted so the loop closes exactly. */
  rpmEff: number;
  /** Angular velocity in radians per frame during the loop. */
  omega: number;
  /** Disc angle at loop frame 0 (= final angle of the intro), in [0, 2π). */
  theta0: number;
  /** introAngles[j] = disc angle at intro frame j, for j in 0..I (index I equals theta0 unwrapped). */
  introAngles: Float64Array;
  /** outroAngles[k] = disc angle at outro frame k (k = 0 continues right after loop frame F-1). */
  outroAngles: Float64Array;
}

export type Segment = 'intro' | 'loop' | 'outro';

export interface FrameRef {
  seg: Segment;
  i: number;
  /** Which loop repetition (0-based) in a full-song sequence. Doesn't affect the image of the loop itself. */
  rep?: number;
}

export function loopTurns(rpm: number, targetLoopSeconds: number): number {
  return Math.max(1, Math.round((targetLoopSeconds * rpm) / 60));
}

export function loopFrames(fps: number, rpm: number, N: number): number {
  return Math.max(1, Math.round((fps * 60 * N) / rpm));
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function easeOutCubic(u: number): number {
  const v = 1 - clamp01(u);
  return 1 - v * v * v;
}

export function easeInCubic(u: number): number {
  const v = clamp01(u);
  return v * v * v;
}

export function easeInOutCubic(u: number): number {
  const x = clamp01(u);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function smoothstep(u: number): number {
  const x = clamp01(u);
  return x * x * (3 - 2 * x);
}

/** Positive modulo for integers. */
export function imod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/**
 * Spin speed profile of the intro as a fraction of omega, for the step going from intro
 * frame j to j+1. Reaches exactly 1 on the last step (j = I-1) with zero slope, so the
 * hand-off to the loop has no jerk.
 */
export function introSpinProfile(j: number, I: number): number {
  const u = (j + 1) / I;
  return smoothstep((u - 0.1) / 0.9);
}

/** Outro speed for the step k → k+1: starts at exactly ω (k = 0) and eases down to 0. */
export function outroSpinProfile(k: number, O: number): number {
  return 1 - smoothstep(k / Math.max(1, O - 1));
}

export function computeTiming(input: TimingInput): Timing {
  const fps = input.fps;
  const N = loopTurns(input.rpm, input.targetLoopSeconds);
  const F = loopFrames(fps, input.rpm, N);
  const rpmEff = (fps * 60 * N) / F;
  const omega = (TAU * N) / F;
  const I = Math.max(0, Math.round(input.introSeconds * fps));
  const O = Math.max(0, Math.round((input.outroSeconds ?? 0) * fps));

  // Integrate angular velocity frame by frame (never interpolate the angle).
  const introAngles = new Float64Array(I + 1);
  let angle = 0;
  for (let j = 0; j < I; j++) {
    introAngles[j] = angle;
    angle += omega * introSpinProfile(j, I);
  }
  introAngles[I] = angle;
  const theta0 = imod(angle, TAU);

  // Outro frame 0 sits exactly where loop frame F would be (θ0), one ω after frame F-1.
  const outroAngles = new Float64Array(O + 1);
  let a = theta0;
  for (let k = 0; k <= O; k++) {
    outroAngles[k] = a;
    a += omega * outroSpinProfile(k, O);
  }

  return { fps, N, F, I, O, rpmEff, omega, theta0, introAngles, outroAngles };
}

const cache = new Map<string, Timing>();

/** Memoized computeTiming (result is identical, it only avoids re-integrating the intro). */
export function getTiming(input: TimingInput): Timing {
  const key = `${input.fps}|${input.rpm}|${input.targetLoopSeconds}|${input.introSeconds}|${input.outroSeconds ?? 0}`;
  let t = cache.get(key);
  if (!t) {
    t = computeTiming(input);
    if (cache.size > 64) cache.clear();
    cache.set(key, t);
  }
  return t;
}

/**
 * Loop angle θ(i) = θ0 + 2π·N·i/F. The fractional turn is computed with integer
 * arithmetic, so θ(i + F) is bit-identical to θ(i).
 */
export function loopAngle(t: Timing, i: number): number {
  return t.theta0 + (TAU * imod(t.N * i, t.F)) / t.F;
}

/** Loop phase φ(i) = i/F mod 1, exact for integer i. */
export function loopPhase(t: Timing, i: number): number {
  return imod(i, t.F) / t.F;
}

export interface FrameState {
  seg: Segment;
  /** Frame index inside its segment (loop index is wrapped to 0..F-1). */
  local: number;
  /** Disc rotation in radians. */
  angle: number;
  /**
   * Pose along the intro path: 0 = disc inside the sleeve (start of intro / end of outro),
   * 1 = loop pose. Linear in time; layouts apply their own easing.
   */
  move: number;
  /** Global loop phase, 0..1. During the intro it runs backwards from the end so it lands on 0. */
  phase: number;
  /** Integer in 0..F-1, used to seed per-frame noise (grain). Periodic with the loop. */
  seed: number;
}

export function toFrameRef(t: Timing, frame: number | FrameRef): FrameRef {
  if (typeof frame !== 'number') return frame;
  return frame < t.I ? { seg: 'intro', i: Math.max(0, frame) } : { seg: 'loop', i: frame - t.I };
}

export function frameState(t: Timing, frame: number | FrameRef): FrameState {
  const ref = toFrameRef(t, frame);
  if (ref.seg === 'intro' && t.I > 0) {
    const j = Math.min(t.I - 1, Math.max(0, ref.i));
    // φIntro(t) = ((t - Tintro) / Tloop) mod 1, in frames: (j - I) / F.
    const k = imod(j - t.I, t.F);
    return { seg: 'intro', local: j, angle: t.introAngles[j], move: j / t.I, phase: k / t.F, seed: k };
  }
  if (ref.seg === 'outro' && t.O > 0) {
    const k = Math.min(t.O - 1, Math.max(0, ref.i));
    const s = imod(k, t.F);
    return {
      seg: 'outro',
      local: k,
      angle: t.outroAngles[k],
      move: t.O > 1 ? 1 - k / (t.O - 1) : 0,
      phase: s / t.F,
      seed: s,
    };
  }
  const i = imod(ref.i, t.F);
  return { seg: 'loop', local: i, angle: loopAngle(t, i), move: 1, phase: loopPhase(t, i), seed: i };
}

/** e.g. "Loop: 216 frames · 7,2 s · 4 vueltas · 33,33 rpm" */
export function describeLoop(t: Timing): string {
  const fmt = (n: number, d: number) =>
    n.toLocaleString('es-AR', { maximumFractionDigits: d, minimumFractionDigits: 0 });
  const secs = t.F / t.fps;
  return `Loop: ${t.F} frames · ${fmt(secs, 2)} s · ${t.N} ${t.N === 1 ? 'vuelta' : 'vueltas'} · ${fmt(t.rpmEff, 2)} rpm`;
}
