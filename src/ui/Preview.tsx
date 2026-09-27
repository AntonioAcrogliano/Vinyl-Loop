import { useEffect, useMemo, useRef } from 'react';
import { canvasFactory } from '../export/common';
import { getBackground } from '../render/backgrounds';
import { buildAssets, framesFor, renderFrame, timingFor, type SceneImages } from '../render/scene';
import type { FrameRef, Timing } from '../render/timing';
import type { SceneConfig } from '../render/types';

export type PreviewMode = 'loop' | 'introLoop' | 'full';

interface Props {
  cfg: SceneConfig;
  images: SceneImages;
  mode: PreviewMode;
  playing: boolean;
  /** Bumped to restart playback from the beginning. */
  restartKey: number;
}

/** Longest side of the preview bitmap; the render is resolution-independent. */
const PREVIEW_MAX = 960;

interface Sequence {
  frames: FrameRef[];
  /** Index playback jumps back to after the last frame. */
  repeatFrom: number;
}

function sequenceFor(t: Timing, mode: PreviewMode, fps: number): Sequence {
  if (mode === 'loop' || (mode === 'introLoop' && t.I === 0)) {
    return { frames: framesFor(t, { intro: false, loops: 1, outro: false }), repeatFrom: 0 };
  }
  if (mode === 'introLoop') {
    return { frames: framesFor(t, { intro: true, loops: 1, outro: false }), repeatFrom: t.I };
  }
  // Full: intro, two loops, outro, then hold the last frame for half a second.
  const frames = framesFor(t, { intro: true, loops: 2, outro: t.O > 0 });
  const last = frames[frames.length - 1];
  for (let k = 0; k < Math.round(fps / 2); k++) frames.push(last);
  return { frames, repeatFrom: 0 };
}

function label(ref: FrameRef, t: Timing): string {
  if (ref.seg === 'intro') return `intro ${ref.i + 1}/${t.I}`;
  if (ref.seg === 'outro') return `outro ${ref.i + 1}/${t.O}`;
  return `loop ${ref.i + 1}/${t.F}`;
}

export function Preview({ cfg, images, mode, playing, restartKey }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const scale = Math.min(1, PREVIEW_MAX / Math.max(cfg.width, cfg.height));
  const pw = Math.max(2, Math.round(cfg.width * scale));
  const ph = Math.max(2, Math.round(cfg.height * scale));
  const timing = timingFor(cfg);
  const seq = useMemo(() => sequenceFor(timing, mode, cfg.fps), [timing, mode, cfg.fps]);

  // Static caches depend only on what they draw, not on timing or background.
  const assets = useMemo(
    () => buildAssets(cfg, images, pw, ph, canvasFactory),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      images,
      pw,
      ph,
      cfg.width,
      cfg.height,
      cfg.layout,
      cfg.sleeveSize,
      cfg.discOut,
      cfg.direction,
      cfg.vinyl.labelSize,
      cfg.vinyl.style,
      cfg.vinyl.color,
      cfg.sleeve.wear,
      cfg.sleeve.innerSleeve,
      cfg.coverCrop,
      cfg.labelCrop,
      cfg.useSeparateLabel,
    ],
  );

  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const clock = useRef({ start: performance.now(), pausedAt: 0 });

  useEffect(() => {
    clock.current = { start: performance.now(), pausedAt: playing ? 0 : performance.now() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restartKey, mode]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    let lastIndex = -1;
    let lastCfg: SceneConfig | null = null;
    if (!playing) {
      if (!clock.current.pausedAt) clock.current.pausedAt = performance.now();
    } else if (clock.current.pausedAt) {
      clock.current.start += performance.now() - clock.current.pausedAt;
      clock.current.pausedAt = 0;
    }

    const tick = () => {
      const c = cfgRef.current;
      const now = playing ? performance.now() : clock.current.pausedAt || performance.now();
      const n = Math.floor(((now - clock.current.start) / 1000) * c.fps);
      const len = seq.frames.length;
      const loopLen = len - seq.repeatFrom;
      const index = n < len ? n : seq.repeatFrom + ((n - seq.repeatFrom) % loopLen);
      if (index !== lastIndex || c !== lastCfg) {
        const frame = seq.frames[index];
        renderFrame(ctx, frame, c, assets);
        lastIndex = index;
        lastCfg = c;
        if (statusRef.current) statusRef.current.textContent = label(frame, timingFor(c));
      }
      if (playing) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [assets, seq, playing, restartKey, cfg]);

  const transparent = getBackground(cfg.background.id).transparent;
  return (
    <div className="preview">
      <div className="stage">
        <canvas
          ref={ref}
          width={pw}
          height={ph}
          className={transparent ? 'checker' : ''}
          style={{ aspectRatio: `${cfg.width} / ${cfg.height}` }}
        />
      </div>
      <div className="preview-status">
        <span ref={statusRef} />
        <span>
          Preview {pw}×{ph} · export {cfg.width}×{cfg.height}
        </span>
      </div>
    </div>
  );
}
