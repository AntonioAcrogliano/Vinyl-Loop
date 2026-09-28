import * as ort from 'onnxruntime-web/webgpu';
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';

// Point the runtime at the files Vite emitted (hashed names in production builds).
ort.env.wasm.wasmPaths = { mjs: ortMjs, wasm: ortWasm };
import { COMPENSATE, DIM_F, DIM_T, GEN, TRIM, istft, stft } from './mdx';

// Vocal isolation with an MDX-Net model (Kim_Vocal_2, from Ultimate Vocal Remover), fully in
// the browser. The song is cut in overlapping ~6 s chunks; each goes through an STFT, the model
// predicts the vocal spectrogram, and an inverse STFT brings it back to audio.

export interface SeparateRequest {
  left: Float32Array; // 44.1 kHz
  right: Float32Array;
  modelUrl: string;
}

export type SeparateMessage =
  | { type: 'download'; progress: number }
  | { type: 'device'; device: string }
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; vocals: Float32Array }
  | { type: 'error'; message: string };

const post = (m: SeparateMessage, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

/** Model bytes from the Cache API (downloaded once, with progress). */
async function modelBytes(url: string): Promise<ArrayBuffer> {
  const cache = await caches.open('vinilo-models-v1');
  const hit = await cache.match(url);
  if (hit) return hit.arrayBuffer();
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`No pude descargar el modelo (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 67_000_000;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    post({ type: 'download', progress: Math.min(1, got / total) });
  }
  const buf = new Uint8Array(got);
  let o = 0;
  for (const p of parts) {
    buf.set(p, o);
    o += p.length;
  }
  await cache.put(url, new Response(buf, { headers: { 'content-type': 'application/octet-stream' } }));
  return buf.buffer;
}

async function session(bytes: ArrayBuffer): Promise<ort.InferenceSession> {
  const hasGpu = 'gpu' in navigator && !!(await (navigator as unknown as { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter().catch(() => null));
  if (hasGpu) {
    try {
      const s = await ort.InferenceSession.create(bytes, { executionProviders: ['webgpu'] });
      post({ type: 'device', device: 'WebGPU' });
      return s;
    } catch {
      // Fall through to CPU.
    }
  }
  const s = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
  post({ type: 'device', device: 'CPU (WASM)' });
  return s;
}

self.onmessage = async (e: MessageEvent<SeparateRequest>) => {
  try {
    const { left, right, modelUrl } = e.data;
    const s = await session(await modelBytes(modelUrl));
    const n = left.length;
    const pad = GEN - (n % GEN);
    const padded = n + pad + 2 * TRIM;
    const L = new Float32Array(padded);
    const R = new Float32Array(padded);
    L.set(left, TRIM);
    R.set(right, TRIM);
    const chunks = (n + pad) / GEN;
    const vocals = new Float32Array(n);
    const input = new Float32Array(4 * DIM_F * DIM_T);
    for (let c = 0; c < chunks; c++) {
      const start = c * GEN;
      stft(L, R, start, input);
      const feeds = { [s.inputNames[0]]: new ort.Tensor('float32', input, [1, 4, DIM_F, DIM_T]) };
      const result = await s.run(feeds);
      const spec = result[s.outputNames[0]].data as Float32Array;
      const wave = istft(spec);
      // Keep the middle of each chunk (the edges overlap with the neighbours' trims).
      for (let i = 0; i < GEN; i++) {
        const o = start + i;
        if (o < n) vocals[o] = wave[TRIM + i] * COMPENSATE;
      }
      post({ type: 'progress', done: c + 1, total: chunks });
    }
    post({ type: 'done', vocals }, [vocals.buffer]);
  } catch (err) {
    post({ type: 'error', message: (err as Error).message ?? String(err) });
  }
};
