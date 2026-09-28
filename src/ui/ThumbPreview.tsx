import { useEffect, useRef } from 'react';
import { canvasFactory } from '../export/common';
import type { SceneImages } from '../render/scene';
import { THUMB_H, THUMB_W, renderThumbnail } from '../render/thumbnail';
import type { SceneConfig } from '../render/types';

/** Preview bitmap size; the thumbnail layout is relative, so it matches the 1280×720 file. */
const PW = 960;
const PH = Math.round((PW * THUMB_H) / THUMB_W);

/** Big still preview of the YouTube thumbnail (replaces the video preview in its tab). */
export function ThumbPreview({ cfg, images }: { cfg: SceneConfig; images: SceneImages }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    // Coalesce fast slider drags into one render per frame.
    const id = requestAnimationFrame(() => {
      const c = ref.current;
      if (c) renderThumbnail(c.getContext('2d')!, cfg, cfg.thumb, images, canvasFactory);
    });
    return () => cancelAnimationFrame(id);
  }, [cfg, images]);

  return (
    <div className="preview">
      <div className="stage" style={{ '--ar': PH / PW } as React.CSSProperties}>
        <div className="canvas-wrap" style={{ aspectRatio: `${PW} / ${PH}`, width: `min(100cqw, calc(100cqh * ${PW / PH}))` }}>
          <canvas ref={ref} width={PW} height={PH} />
        </div>
      </div>
      <div className="preview-status">
        <span>Miniatura · {THUMB_W}×{THUMB_H}</span>
      </div>
    </div>
  );
}
