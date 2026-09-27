import { buildAssets, framesFor, planTag, renderFrame, timingFor, type ExportPlan, type SceneImages } from '../render/scene';
import type { AnyCanvas, CanvasFactory, Ctx2D, SceneConfig } from '../render/types';

export type ExportFormat = 'mp4' | 'webm' | 'png' | 'prores';

export interface ExportJob {
  cfg: SceneConfig;
  images: SceneImages;
  plan: ExportPlan;
  format: ExportFormat;
  /** Base name, usually the photo file name without extension. */
  name: string;
  /** `stage` describes the current step when an export has more than one (render, encode…). */
  onProgress?: (done: number, total: number, stage?: string) => void;
  signal?: AbortSignal;
}

export interface ExportResult {
  blob: Blob;
  filename: string;
}

export const canvasFactory: CanvasFactory = (w, h) => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

export function exportFilename(job: Pick<ExportJob, 'cfg' | 'plan' | 'name'>, frames: number, ext: string): string {
  const { cfg } = job;
  const safe = (job.name || 'vinilo').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'vinilo';
  return `${safe}_${planTag(job.plan)}_${cfg.width}x${cfg.height}_${cfg.fps}fps_${frames}f.${ext}`;
}

export function frameCount(job: Pick<ExportJob, 'cfg' | 'plan'>): number {
  return framesFor(timingFor(job.cfg), job.plan).length;
}

export class ExportCancelled extends Error {
  constructor() {
    super('Exportación cancelada');
  }
}

/**
 * Renders the requested frames one by one on a full-size canvas and hands each to `sink`
 * together with its position in the output. No screen recording: timestamps are exact.
 */
export async function renderSequence(
  job: ExportJob,
  sink: (canvas: AnyCanvas, k: number, total: number) => Promise<void>,
  canvas: AnyCanvas,
): Promise<number> {
  const { cfg } = job;
  const t = timingFor(cfg);
  const frames = framesFor(t, job.plan);
  if (frames.length === 0) throw new Error('No hay frames para exportar: elegí intro, loop u outro.');
  const assets = buildAssets(cfg, job.images, cfg.width, cfg.height, canvasFactory);
  const ctx = canvas.getContext('2d', { alpha: true }) as Ctx2D;
  for (let k = 0; k < frames.length; k++) {
    if (job.signal?.aborted) throw new ExportCancelled();
    renderFrame(ctx, frames[k], cfg, assets);
    await sink(canvas, k, frames.length);
    job.onProgress?.(k + 1, frames.length, 'Renderizando');
    // Let the UI breathe (progress bar, cancel button).
    if (k % 4 === 3) await yieldToEventLoop();
  }
  return frames.length;
}

/**
 * Macrotask yield via MessageChannel. Unlike setTimeout, it isn't throttled to ~1 s when
 * the tab is in the background, so exports keep full speed if the user switches tabs.
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(null);
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
