import { useEffect, useLayoutEffect, useState } from 'react';

// Guided tour: dims the page, lights up one part of it and explains it in a small card.

export interface TourStep {
  /** CSS selector of what to highlight (the first visible match); none = centered card. */
  target?: string;
  title: string;
  text: string;
  /** Called before the step is shown (e.g. switch to the tab it talks about). */
  before?: () => void;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PAD = 8;
const CARD_W = 320;

function findTarget(sel?: string): Element | null {
  if (!sel) return null;
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

export function Tour({ steps, onClose }: { steps: TourStep[]; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const step = steps[i];
  const last = i === steps.length - 1;

  useLayoutEffect(() => {
    step.before?.();
    // Let the tab render, then bring the target into view.
    const id = setTimeout(() => findTarget(step.target)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 60);
    return () => clearTimeout(id);
  }, [step]);

  // Follow the target while it moves (panel animations, scrolling, resizes).
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = findTarget(step.target);
      if (el) {
        const r = el.getBoundingClientRect();
        // Clip tall targets (a whole panel) to the viewport.
        const y = Math.max(r.top, 0);
        const bottom = Math.min(r.bottom, window.innerHeight);
        setRect((old) => {
          const n = { x: r.left, y, w: r.width, h: Math.max(0, bottom - y) };
          return old && Math.abs(old.x - n.x) < 0.5 && Math.abs(old.y - n.y) < 0.5 && Math.abs(old.w - n.w) < 0.5 && Math.abs(old.h - n.h) < 0.5 ? old : n;
        });
      } else setRect(null);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') last ? onClose() : setI((k) => k + 1);
      else if (e.key === 'ArrowLeft') setI((k) => Math.max(0, k - 1));
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    // Capture: the preview also listens to the arrows.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [last, onClose]);

  // Card position: beside the highlight where there is room, else below / above; centered without one.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const narrow = vw < 640;
  let style: React.CSSProperties;
  if (!rect || narrow) {
    style = narrow ? { left: 12, right: 12, bottom: 12 } : { left: (vw - CARD_W) / 2, top: vh / 2 - 90 };
    if (narrow && rect && rect.y + rect.h > vh * 0.62) style = { left: 12, right: 12, top: 12 };
  } else {
    const right = rect.x + rect.w + PAD + 14;
    const left = rect.x - PAD - 14 - CARD_W;
    const top = Math.min(Math.max(12, rect.y), vh - 230);
    if (right + CARD_W < vw - 12) style = { left: right, top };
    else if (left > 12) style = { left, top };
    else if (rect.y + rect.h + 240 < vh) style = { left: Math.min(Math.max(12, rect.x), vw - CARD_W - 12), top: rect.y + rect.h + PAD + 12 };
    else style = { left: Math.min(Math.max(12, rect.x), vw - CARD_W - 12), top: Math.max(12, rect.y - 230) };
  }

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label="Tutorial">
      {rect ? (
        <div className="tour-hole" style={{ left: rect.x - PAD, top: rect.y - PAD, width: rect.w + PAD * 2, height: rect.h + PAD * 2 }} />
      ) : (
        <div className="tour-dim" />
      )}
      <div className="tour-card" style={narrow ? style : { ...style, width: CARD_W }} key={i}>
        <div className="tour-top">
          <span className="tour-count">
            {i + 1} de {steps.length}
          </span>
          <button type="button" className="link" onClick={onClose}>
            Saltar
          </button>
        </div>
        <h3>{step.title}</h3>
        <p>{step.text}</p>
        <div className="tour-dots" aria-hidden>
          {steps.map((_, k) => (
            <i key={k} className={k === i ? 'on' : k < i ? 'done' : ''} />
          ))}
        </div>
        <div className="tour-actions">
          {i > 0 && (
            <button type="button" className="secondary" onClick={() => setI(i - 1)}>
              Atrás
            </button>
          )}
          <button type="button" className="primary" autoFocus onClick={() => (last ? onClose() : setI(i + 1))}>
            {last ? '¡A crear!' : 'Siguiente'}
          </button>
        </div>
      </div>
    </div>
  );
}
