import type { Crop, ImageLike } from './types';

export interface SourceRect {
  sx: number;
  sy: number;
  side: number;
}

/** Square source rectangle for a crop, clamped inside the image. */
export function cropRect(img: { width: number; height: number }, crop: Crop): SourceRect {
  const side = Math.min(img.width, img.height) / Math.max(1, crop.zoom);
  const sx = clamp(crop.cx * img.width - side / 2, 0, img.width - side);
  const sy = clamp(crop.cy * img.height - side / 2, 0, img.height - side);
  return { sx, sy, side };
}

/** Returns the crop with its center moved so the square stays inside the image. */
export function clampCrop(img: { width: number; height: number }, crop: Crop): Crop {
  const zoom = clamp(crop.zoom, 1, 8);
  const r = cropRect(img, { ...crop, zoom });
  return {
    zoom,
    cx: (r.sx + r.side / 2) / img.width,
    cy: (r.sy + r.side / 2) / img.height,
  };
}

export function drawCropped(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  img: ImageLike,
  crop: Crop,
  dx: number,
  dy: number,
  size: number,
): void {
  const r = cropRect(img, crop);
  ctx.drawImage(img, r.sx, r.sy, r.side, r.side, dx, dy, size, size);
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
