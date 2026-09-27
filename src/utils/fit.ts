import { computeTiming } from '../render/timing';
import type { SceneConfig } from '../render/types';

export interface SongFit {
  introSeconds: number;
  outroSeconds: number;
  loops: number;
  /** Frames in the resulting video: exactly round(duration · fps). */
  totalFrames: number;
  introFrames: number;
  outroFrames: number;
  loopFrames: number;
}

const MIN_SIDE = 1; // s: shortest intro / outro
const MAX_SIDE = 12; // s: longest intro / outro

/**
 * Plans intro + N loops + outro so the video lasts exactly as long as the song (to the frame).
 * The loop length is fixed by the loop math (whole turns), so the leftover time goes to the
 * intro and outro, split like the current intro/outro durations, each kept within 1–12 s.
 * Returns null if the song is too short for one loop plus a minimal intro and outro.
 */
export function fitToDuration(durationSec: number, cfg: SceneConfig): SongFit | null {
  if (!(durationSec > 0)) return null;
  const { fps } = cfg;
  const t = computeTiming({ fps, rpm: cfg.rpm, targetLoopSeconds: cfg.targetLoopSeconds, introSeconds: 0 });
  const F = t.F;
  const total = Math.round(durationSec * fps);
  const minSide = Math.round(MIN_SIDE * fps);
  const maxSide = Math.round(MAX_SIDE * fps);
  const prefIn = Math.max(minSide, Math.round((cfg.introEnabled ? cfg.introSeconds : 2.5) * fps));
  const prefOut = Math.max(minSide, Math.round((cfg.outroEnabled ? cfg.outroSeconds : 2.5) * fps));

  // Start from the loop count closest to the preferred intro/outro, then fix the bounds.
  let loops = Math.max(1, Math.round((total - prefIn - prefOut) / F));
  for (let guard = 0; guard < 1000; guard++) {
    const rem = total - loops * F;
    if (rem < 2 * minSide) {
      if (loops === 1) return null;
      loops--;
    } else if (rem > 2 * maxSide) {
      loops++;
    } else {
      break;
    }
  }
  const rem = total - loops * F;
  if (rem < 2 * minSide) return null;

  // Split the remainder like the preferred durations, respecting the bounds.
  let intro = Math.round((rem * prefIn) / (prefIn + prefOut));
  intro = Math.min(maxSide, Math.max(minSide, intro));
  let outro = rem - intro;
  if (outro > maxSide) {
    outro = maxSide;
    intro = rem - outro;
  } else if (outro < minSide) {
    outro = minSide;
    intro = rem - outro;
  }
  return {
    introSeconds: intro / fps,
    outroSeconds: outro / fps,
    loops,
    totalFrames: total,
    introFrames: intro,
    outroFrames: outro,
    loopFrames: F,
  };
}

/** "3:42" / "3:42.5" / "222" (seconds) → seconds. */
export function parseDuration(text: string): number | null {
  const s = text.trim().replace(',', '.');
  if (!s) return null;
  const parts = s.split(':');
  if (parts.length > 3 || parts.some((p) => p === '' || isNaN(Number(p)))) return null;
  const secs = parts.reduce((acc, p) => acc * 60 + Number(p), 0);
  return secs > 0 ? secs : null;
}

/** 222.4 → "3:42" */
export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  const ss = Math.round(s * 10) / 10;
  const whole = Number.isInteger(ss);
  return `${m}:${(whole ? String(ss) : ss.toFixed(1)).padStart(whole ? 2 : 4, '0')}`;
}
