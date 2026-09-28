import { useEffect, useMemo, useRef, useState } from 'react';
import type { Song } from '../audio/song';
import { lineEnd, type LyricLine, type Lyrics } from '../lyrics/lyrics';

// Visual timing editor: waveform of the song (or of the isolated vocals) with every lyric
// line as a block. Drag a block to move the line, drag its edges to change start / end,
// click the waveform to jump there, double-click a block to listen from it.

interface Props {
  song: Song;
  audio: HTMLAudioElement | null;
  lyrics: Lyrics;
  /** Raw setter (no undo snapshot); call onBeginEdit once before a drag. */
  setLyrics: (l: Lyrics) => void;
  onBeginEdit: () => void;
  onUndo: (() => void) | null;
  /** Global lyric offset (cfg.lyrics.offset): blocks are drawn where they are heard. */
  offset: number;
  onPlayAt: (seconds: number) => void;
  /** Isolated vocals (44.1 kHz), when available: a much more readable waveform. */
  vocals: Float32Array | null;
}

const PEAKS_PER_SEC = 100;
const RULER = 16;

/** Max-abs per 10 ms. */
function peaksOf(pcm: Float32Array, rate: number): Float32Array {
  const step = rate / PEAKS_PER_SEC;
  const out = new Float32Array(Math.ceil(pcm.length / step));
  for (let i = 0; i < out.length; i++) {
    let m = 0;
    const a = Math.floor(i * step);
    const b = Math.min(pcm.length, Math.floor((i + 1) * step));
    for (let k = a; k < b; k++) {
      const v = Math.abs(pcm[k]);
      if (v > m) m = v;
    }
    out[i] = m;
  }
  // Normalize so quiet songs still show a shape.
  let max = 0;
  for (const v of out) if (v > max) max = v;
  if (max > 0) for (let i = 0; i < out.length; i++) out[i] /= max;
  return out;
}

type Drag =
  | { kind: 'move' | 'start' | 'end'; line: number; x0: number; orig: LyricLine }
  | { kind: 'pan'; x0: number; view0: number }
  | null;

export function LyricsTimeline({ song, audio, lyrics, setLyrics, onBeginEdit, onUndo, offset, onPlayAt, vocals }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(600);
  const [mixPeaks, setMixPeaks] = useState<Float32Array | null>(null);
  const peaks = useMemo(() => (vocals ? peaksOf(vocals, 44100) : mixPeaks), [vocals, mixPeaks]);
  const [view, setView] = useState({ start: 0, span: 20 }); // seconds
  const [follow, setFollow] = useState(true);
  const drag = useRef<Drag>(null);
  const [hover, setHover] = useState<string>('');

  // Mix waveform (decoded at 8 kHz: enough for a waveform, fast to decode).
  useEffect(() => {
    let alive = true;
    (async () => {
      const buf = await new OfflineAudioContext(1, 1, 8000).decodeAudioData(await song.file.arrayBuffer());
      const ch = buf.getChannelData(0);
      if (alive) setMixPeaks(peaksOf(ch, 8000));
    })();
    return () => {
      alive = false;
    };
  }, [song]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const lines = lyrics.lines;
  const pxPerSec = width / view.span;
  const tToX = (t: number) => (t - view.start) * pxPerSec;
  const xToT = (x: number) => view.start + x / pxPerSec;
  const H = 150;
  const laneTop = RULER + 60;
  const laneH = 30;
  // Sorted order for lineEnd (what the renderer uses), but keep editing indices.
  const order = useMemo(() => lines.map((l, i) => ({ l, i })).filter((x) => Number.isFinite(x.l.start)).sort((a, b) => a.l.start - b.l.start), [lines]);
  const blocks = useMemo(() => {
    const sorted = order.map((o) => o.l);
    return order.map((o, k) => ({ index: o.i, start: o.l.start + offset, end: lineEnd(sorted, k) + offset, row: k % 2, text: o.l.text }));
  }, [order, offset]);

  // Draw (and keep the playhead moving).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    const draw = () => {
      const now = audio?.currentTime ?? 0;
      let v = view;
      if (follow && audio && !audio.paused && (now < v.start || now > v.start + v.span * 0.85)) {
        v = { start: Math.max(0, now - v.span * 0.15), span: v.span };
        setView(v);
        return;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, H);
      ctx.fillStyle = '#141417';
      ctx.fillRect(0, 0, width, H);
      // Ruler
      ctx.fillStyle = '#6d6b73';
      ctx.font = '10px system-ui, sans-serif';
      const step = v.span > 60 ? 10 : v.span > 20 ? 5 : 1;
      for (let s = Math.ceil(v.start / step) * step; s < v.start + v.span; s += step) {
        const x = tToX(s);
        ctx.fillRect(x, 0, 1, s % (step * 5) === 0 ? 8 : 5);
        if (s % (step * (step === 1 ? 5 : 2)) === 0) ctx.fillText(`${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`, x + 3, 10);
      }
      // Waveform
      if (peaks) {
        const mid = RULER + (H - RULER) / 2;
        const amp = (H - RULER) * 0.45;
        ctx.fillStyle = vocals ? 'rgba(123,211,137,0.45)' : 'rgba(155,153,161,0.35)';
        for (let x = 0; x < width; x++) {
          const a = Math.floor(xToT(x) * PEAKS_PER_SEC);
          const b = Math.max(a + 1, Math.floor(xToT(x + 1) * PEAKS_PER_SEC));
          let m = 0;
          for (let k = a; k < b && k < peaks.length; k++) if (k >= 0 && peaks[k] > m) m = peaks[k];
          const h = m * amp;
          ctx.fillRect(x, mid - h, 1, h * 2 || 1);
        }
      }
      // Blocks
      const current = blocks.findIndex((b) => now >= b.start && now < b.end);
      blocks.forEach((b, k) => {
        const x0 = tToX(b.start);
        const x1 = tToX(b.end);
        if (x1 < 0 || x0 > width) return;
        const y = laneTop + b.row * (laneH + 4) - laneH;
        const on = k === current;
        ctx.fillStyle = on ? 'rgba(238,90,58,0.9)' : 'rgba(238,90,58,0.35)';
        ctx.strokeStyle = 'rgba(238,90,58,1)';
        ctx.beginPath();
        ctx.roundRect(x0, y, Math.max(3, x1 - x0), laneH, 5);
        ctx.fill();
        ctx.stroke();
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0 + 4, y, Math.max(0, x1 - x0 - 8), laneH);
        ctx.clip();
        ctx.fillStyle = '#fff';
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillText(b.text, x0 + 6, y + laneH / 2 + 4);
        ctx.restore();
      });
      // Playhead
      const px = tToX(now);
      ctx.fillStyle = '#fff';
      ctx.fillRect(px - 0.5, 0, 1.5, H);
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, view, peaks, blocks, audio, follow, vocals]);

  const hit = (x: number, y: number) => {
    for (let k = blocks.length - 1; k >= 0; k--) {
      const b = blocks[k];
      const x0 = tToX(b.start);
      const x1 = tToX(b.end);
      const top = laneTop + b.row * (laneH + 4) - laneH;
      if (y < top || y > top + laneH || x < x0 - 4 || x > x1 + 4) continue;
      const kind = x - x0 < 7 ? 'start' : x1 - x < 7 ? 'end' : 'move';
      return { b, kind: kind as 'start' | 'end' | 'move' };
    }
    return null;
  };

  const local = (e: React.PointerEvent | React.MouseEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const apply = (i: number, patch: (l: LyricLine) => LyricLine) => {
    const next = lines.slice();
    next[i] = patch(lines[i]);
    setLyrics({ ...lyrics, lines: next });
  };

  /** Line moved / resized: shift or rescale its word timings along. */
  const retime = (orig: LyricLine, start: number, end: number, setEnd = false): LyricLine => {
    const oStart = orig.start;
    const oEnd = orig.end ?? orig.words?.[orig.words.length - 1]?.end ?? oStart + 2;
    const k = (end - start) / Math.max(0.05, oEnd - oStart);
    return {
      ...orig,
      start,
      end: setEnd || orig.end !== undefined || orig.words ? end : undefined,
      words: orig.words?.map((w) => ({ ...w, start: start + (w.start - oStart) * k, end: start + (w.end - oStart) * k })),
    };
  };

  return (
    <div className="lyrics-timeline" ref={wrapRef}>
      <div className="lt-bar">
        <b className="nowrap">Tiempos de la letra</b>
        <span className="hint">
          {hover || 'Arrastrá un bloque para moverlo, sus bordes para ajustarlo · clic en la onda para ir ahí · doble clic para escuchar'}
        </span>
        <div className="spacer" />
        <button type="button" className="secondary small-btn" disabled={!onUndo} onClick={() => onUndo?.()} title="Ctrl+Z">
          Deshacer
        </button>
        <label className="check mini-check">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          <span className="switch" aria-hidden />
          Seguir
        </label>
        <button type="button" className="icon-btn small" title="Alejar" onClick={() => setView((v) => ({ ...v, span: Math.min(song.duration, v.span * 1.5) }))}>
          −
        </button>
        <button type="button" className="icon-btn small" title="Acercar" onClick={() => setView((v) => ({ ...v, span: Math.max(3, v.span / 1.5) }))}>
          +
        </button>
      </div>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: H, touchAction: 'none', cursor: 'default' }}
        onPointerDown={(e) => {
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
          const { x, y } = local(e);
          const h = hit(x, y);
          if (h) {
            onBeginEdit();
            drag.current = { kind: h.kind, line: h.b.index, x0: x, orig: lines[h.b.index] };
          }
          else drag.current = { kind: 'pan', x0: x, view0: view.start };
        }}
        onPointerMove={(e) => {
          const { x, y } = local(e);
          const d = drag.current;
          const canvas = canvasRef.current!;
          if (!d) {
            const h = hit(x, y);
            canvas.style.cursor = h ? (h.kind === 'move' ? 'grab' : 'ew-resize') : 'pointer';
            setHover(h ? `“${h.b.text}” · ${h.b.start.toFixed(2)} s` : '');
            return;
          }
          const dt = (x - d.x0) / pxPerSec;
          if (d.kind === 'pan') {
            setFollow(false);
            setView((v) => ({ ...v, start: Math.max(0, d.view0 - dt) }));
            return;
          }
          const o = d.orig;
          const oEnd = o.end ?? o.words?.[o.words.length - 1]?.end ?? blocks.find((b) => b.index === d.line)!.end - offset;
          if (d.kind === 'move') apply(d.line, () => retime(o, Math.max(0, o.start + dt), Math.max(0, oEnd + dt)));
          else if (d.kind === 'start') apply(d.line, () => retime(o, Math.max(0, Math.min(oEnd - 0.1, o.start + dt)), oEnd, true));
          else apply(d.line, () => retime(o, o.start, Math.max(o.start + 0.1, oEnd + dt), true));
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          const { x } = local(e);
          // A click (no drag) on the waveform jumps there.
          if (d?.kind === 'pan' && Math.abs(x - d.x0) < 3) onPlayAt(Math.max(0, xToT(x)));
        }}
        onDoubleClick={(e) => {
          const { x, y } = local(e);
          const h = hit(x, y);
          if (h) onPlayAt(Math.max(0, h.b.start - 0.5));
        }}
        onWheel={(e) => {
          const { x } = local(e);
          if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > Math.abs(e.deltaX) * 2) {
            // Zoom around the pointer.
            const t = xToT(x);
            setView((v) => {
              const span = Math.min(song.duration, Math.max(3, v.span * Math.exp(e.deltaY * 0.002)));
              return { span, start: Math.max(0, t - (x / width) * span) };
            });
          } else {
            setFollow(false);
            setView((v) => ({ ...v, start: Math.max(0, v.start + e.deltaX / pxPerSec) }));
          }
        }}
      />
    </div>
  );
}
