import type { Ctx2D } from '../render/types';
import { encodePng } from '../utils/png';
import { canvasFactory, renderSequence, type ExportJob } from './common';

type Encoder = {
  encode(pixels: Uint8ClampedArray, width: number, height: number): Promise<Uint8Array>;
  dispose(): void;
  size: number;
};

/** Pool of workers encoding PNGs in parallel; falls back to the main thread without Worker support. */
function createEncoder(): Encoder {
  const n = typeof Worker === 'undefined' ? 0 : Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
  if (n === 0) {
    return { encode: async (p, w, h) => encodePng(p, w, h, 1), dispose() {}, size: 1 };
  }
  const workers = Array.from(
    { length: n },
    () => new Worker(new URL('./pngWorker.ts', import.meta.url), { type: 'module' }),
  );
  const pending = new Map<number, { resolve: (b: Uint8Array) => void; reject: (e: unknown) => void }>();
  for (const w of workers) {
    w.onmessage = (e: MessageEvent<{ id: number; png: Uint8Array }>) => {
      pending.get(e.data.id)?.resolve(e.data.png);
      pending.delete(e.data.id);
    };
    w.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(`Worker PNG: ${e.message}`));
      pending.clear();
    };
  }
  let next = 0;
  return {
    size: n,
    encode(pixels, width, height) {
      const id = next++;
      const buf = pixels.buffer as ArrayBuffer;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        workers[id % n].postMessage({ id, pixels: buf, width, height }, [buf]);
      });
    },
    dispose() {
      for (const w of workers) w.terminate();
    },
  };
}

/**
 * Renders the job and encodes every frame to PNG (real alpha) in parallel workers.
 * `begin(k, total)` is called in frame order, synchronously after rendering frame k, and
 * returns the handler that receives that frame's PNG once it's encoded (possibly later).
 */
export async function renderPngSequence(
  job: ExportJob,
  begin: (k: number, total: number) => (png: Uint8Array) => void | Promise<void>,
): Promise<number> {
  const { cfg } = job;
  const canvas = canvasFactory(cfg.width, cfg.height);
  const encoder = createEncoder();
  // Bounded number of frames in flight keeps memory flat for long / 4K exports.
  const inFlight: Promise<void>[] = [];
  const maxInFlight = encoder.size * 2;
  try {
    const frames = await renderSequence(
      job,
      async (c, k, total) => {
        const handler = begin(k, total);
        const { data } = (c.getContext('2d') as Ctx2D).getImageData(0, 0, c.width, c.height);
        inFlight.push(encoder.encode(data, c.width, c.height).then(handler));
        if (inFlight.length >= maxInFlight) await inFlight.shift();
      },
      canvas,
    );
    await Promise.all(inFlight);
    return frames;
  } finally {
    encoder.dispose();
  }
}

export function frameName(k: number, total: number): string {
  return `frame_${String(k).padStart(Math.max(5, String(total - 1).length), '0')}.png`;
}
