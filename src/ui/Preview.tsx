import { useCallback, useEffect, useMemo, useRef } from 'react';
import { canvasFactory } from '../export/common';
import { getBackground } from '../render/backgrounds';
import { buildAssets, framesFor, renderFrame, timingFor, type SceneImages } from '../render/scene';
import type { FrameRef, Segment, Timing } from '../render/timing';
import type { SceneConfig } from '../render/types';
import { Icon } from './icons';

export type PreviewMode = 'loop' | 'introLoop' | 'full';

interface Props {
  cfg: SceneConfig;
  images: SceneImages;
  mode: PreviewMode;
  playing: boolean;
  setPlaying: (p: boolean | ((p: boolean) => boolean)) => void;
  /** Bumped to restart playback from the beginning. */
  restartKey: number;
  hasPhoto: boolean;
  onPickPhoto: () => void;
}

/** Longest side of the preview bitmap; the render is resolution-independent. */
const PREVIEW_MAX = 960;

interface Sequence {
  frames: FrameRef[];
  /** Index playback jumps back to after the last frame. */
  repeatFrom: number;
  /** Contiguous runs of the same segment, for the timeline. */
  parts: { seg: Segment; start: number; len: number }[];
}

function sequenceFor(t: Timing, mode: PreviewMode, fps: number): Sequence {
  let frames: FrameRef[];
  let repeatFrom = 0;
  if (mode === 'loop' || (mode === 'introLoop' && t.I === 0)) {
    frames = framesFor(t, { intro: false, loops: 1, outro: false });
  } else if (mode === 'introLoop') {
    frames = framesFor(t, { intro: true, loops: 1, outro: false });
    repeatFrom = t.I;
  } else {
    // Full: intro, two loops, outro, then hold the last frame for half a second.
    frames = framesFor(t, { intro: true, loops: 2, outro: t.O > 0 });
    const last = frames[frames.length - 1];
    for (let k = 0; k < Math.round(fps / 2); k++) frames.push(last);
  }
  const parts: Sequence['parts'] = [];
  frames.forEach((f, i) => {
    const prev = parts[parts.length - 1];
    // Each loop repetition is its own part, so the timeline shows where the loop point is.
    const newLoop = f.seg === 'loop' && f.i === 0;
    if (prev && prev.seg === f.seg && !newLoop) prev.len++;
    else parts.push({ seg: f.seg, start: i, len: 1 });
  });
  return { frames, repeatFrom, parts };
}

const SEG_NAME: Record<Segment, string> = { intro: 'Intro', loop: 'Loop', outro: 'Outro' };

function describe(ref: FrameRef, t: Timing): string {
  const total = ref.seg === 'intro' ? t.I : ref.seg === 'outro' ? t.O : t.F;
  return `${SEG_NAME[ref.seg]} · frame ${ref.i + 1}/${total}`;
}

export function Preview({ cfg, images, mode, playing, setPlaying, restartKey, hasPhoto, onPickPhoto }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
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
      cfg.layout,
      cfg.sleeveSize,
      cfg.discOut,
      cfg.direction,
      cfg.vinyl.labelSize,
      cfg.vinyl.style,
      cfg.vinyl.color,
      cfg.sleeve,
      cfg.label,
      cfg.coverCrop,
      cfg.labelCrop,
      // Label presets print the rpm.
      cfg.label.source === 'preset' ? cfg.rpm : 0,
    ],
  );

  // Playback clock: position in frames = anchorPos (+ elapsed time while playing).
  const clock = useRef({ anchorTime: performance.now(), anchorPos: 0 });
  const live = useRef({ cfg, seq, playing, assets });
  live.current = { cfg, seq, playing, assets };
  const posNow = useCallback(() => {
    const c = clock.current;
    return live.current.playing ? c.anchorPos + ((performance.now() - c.anchorTime) / 1000) * live.current.cfg.fps : c.anchorPos;
  }, []);
  const seek = useCallback((pos: number) => {
    clock.current = { anchorTime: performance.now(), anchorPos: Math.max(0, pos) };
  }, []);
  const indexNow = useCallback(() => {
    const { seq: s } = live.current;
    const n = Math.floor(posNow() + 1e-6);
    const len = s.frames.length;
    return n < len ? n : s.repeatFrom + ((n - s.repeatFrom) % (len - s.repeatFrom));
  }, [posNow]);

  // Re-anchor on play/pause so the position doesn't jump.
  const prevPlaying = useRef(playing);
  if (prevPlaying.current !== playing) {
    const c = clock.current;
    const elapsed = prevPlaying.current ? ((performance.now() - c.anchorTime) / 1000) * cfg.fps : 0;
    clock.current = { anchorTime: performance.now(), anchorPos: c.anchorPos + elapsed };
    prevPlaying.current = playing;
  }

  useEffect(() => seek(0), [restartKey, mode, seek]);

  // One render loop for the component's lifetime; it only draws when the frame changes.
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    let last: { index: number; cfg: SceneConfig | null; assets: unknown; seq: unknown } = { index: -1, cfg: null, assets: null, seq: null };
    const tick = () => {
      const { cfg: c, seq: s, assets: a } = live.current;
      const index = indexNow();
      if (index !== last.index || c !== last.cfg || a !== last.assets || s !== last.seq) {
        renderFrame(ctx, s.frames[index], c, a);
        last = { index, cfg: c, assets: a, seq: s };
        const t = timingFor(c);
        if (statusRef.current) statusRef.current.textContent = describe(s.frames[index], t);
        if (timeRef.current) {
          const f = (n: number) => (n / c.fps).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          timeRef.current.textContent = `${f(index)} / ${f(s.frames.length)} s`;
        }
        if (headRef.current) headRef.current.style.left = `${((index + 0.5) / s.frames.length) * 100}%`;
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [indexNow]);

  // Timeline scrubbing: click or drag on the bar; pauses while dragging.
  const scrubbing = useRef<{ wasPlaying: boolean } | null>(null);
  const seekToPointer = (clientX: number) => {
    const bar = barRef.current;
    if (!bar) return;
    const r = bar.getBoundingClientRect();
    const u = Math.min(0.9999, Math.max(0, (clientX - r.left) / r.width));
    seek(Math.floor(u * seq.frames.length));
  };

  // Keyboard: space = play/pause, ←/→ = one frame (Shift: one second), Home = start.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable]')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const step = (e.shiftKey ? live.current.cfg.fps : 1) * (e.key === 'ArrowRight' ? 1 : -1);
        setPlaying(false);
        const len = live.current.seq.frames.length;
        seek((((indexNow() + step) % len) + len) % len);
      } else if (e.key === 'Home') {
        e.preventDefault();
        seek(0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [seek, indexNow, setPlaying]);

  const transparent = getBackground(cfg.background.id).transparent;
  const total = seq.frames.length;
  return (
    <div className="preview">
      <div className="stage" style={{ '--ar': cfg.height / cfg.width } as React.CSSProperties}>
        <div
          className="canvas-wrap"
          style={{
            aspectRatio: `${cfg.width} / ${cfg.height}`,
            // Fit inside the stage in both directions (the stage is a size container).
            width: `min(100cqw, calc(100cqh * ${cfg.width / cfg.height}))`,
          }}
        >
          <canvas ref={ref} width={pw} height={ph} className={transparent ? 'checker' : ''} />
          {!hasPhoto && (
            <button type="button" className="empty-card" onClick={onPickPhoto}>
              <Icon name="upload" size={20} />
              <span>
                <b>Subí tu foto</b>
                <small>Arrastrala a cualquier parte o hacé clic</small>
              </span>
            </button>
          )}
        </div>
      </div>
      <div className="transport">
        <button type="button" className="icon-btn" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pausa' : 'Reproducir'} title="Espacio">
          <Icon name={playing ? 'pause' : 'play'} />
        </button>
        <div
          className="timeline"
          ref={barRef}
          role="slider"
          aria-label="Posición"
          aria-valuemin={0}
          aria-valuemax={total - 1}
          tabIndex={0}
          onPointerDown={(e) => {
            (e.currentTarget as Element).setPointerCapture(e.pointerId);
            scrubbing.current = { wasPlaying: playing };
            setPlaying(false);
            seekToPointer(e.clientX);
          }}
          onPointerMove={(e) => scrubbing.current && seekToPointer(e.clientX)}
          onPointerUp={() => {
            if (scrubbing.current?.wasPlaying) setPlaying(true);
            scrubbing.current = null;
          }}
        >
          {seq.parts.map((p, i) => (
            <div key={i} className={`part ${p.seg}`} style={{ flexGrow: p.len }} title={SEG_NAME[p.seg]}>
              {p.len / total > 0.08 && <span>{SEG_NAME[p.seg]}</span>}
            </div>
          ))}
          <div className="playhead" ref={headRef} />
        </div>
      </div>
      <div className="preview-status">
        <span ref={statusRef} />
        <span ref={timeRef} />
        <span className="keys" title="Atajos">
          <kbd>Espacio</kbd> play · <kbd>←</kbd>
          <kbd>→</kbd> frame · <kbd>Shift</kbd> 1 s
        </span>
      </div>
    </div>
  );
}
