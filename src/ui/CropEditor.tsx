import { useEffect, useRef } from 'react';
import { clampCrop, drawCropped } from '../render/crop';
import type { Crop, ImageLike } from '../render/types';

interface Props {
  image: ImageLike;
  crop: Crop;
  shape: 'square' | 'circle';
  onChange: (crop: Crop) => void;
}

const VIEW = 220;

/** Shows the cropped region; drag to pan, wheel or slider to zoom. */
export function CropEditor({ image, crop, shape, onChange }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; crop: Crop } | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = VIEW * dpr;
    canvas.height = VIEW * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    drawCropped(ctx, image, crop, 0, 0, canvas.width);
    if (shape === 'circle') {
      const r = canvas.width / 2;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, canvas.width, canvas.height);
      ctx.arc(r, r, r, 0, Math.PI * 2, true);
      ctx.fillStyle = 'rgba(15,15,18,0.72)';
      ctx.fill('evenodd');
      ctx.restore();
    }
  }, [image, crop, shape]);

  const side = Math.min(image.width, image.height) / crop.zoom;

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, crop };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const scale = side / VIEW; // image px per screen px
    onChange(
      clampCrop(image, {
        ...d.crop,
        cx: d.crop.cx - ((e.clientX - d.x) * scale) / image.width,
        cy: d.crop.cy - ((e.clientY - d.y) * scale) / image.height,
      }),
    );
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onWheel = (e: React.WheelEvent) => {
    onChange(clampCrop(image, { ...crop, zoom: crop.zoom * Math.exp(-e.deltaY * 0.0015) }));
  };

  return (
    <div className="crop">
      <canvas
        ref={ref}
        className={shape === 'circle' ? 'crop-canvas circle' : 'crop-canvas'}
        style={{ width: VIEW, height: VIEW }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      />
      <label className="row">
        <span>Zoom</span>
        <input
          type="range"
          min={1}
          max={8}
          step={0.01}
          value={crop.zoom}
          onChange={(e) => onChange(clampCrop(image, { ...crop, zoom: Number(e.target.value) }))}
        />
      </label>
    </div>
  );
}
