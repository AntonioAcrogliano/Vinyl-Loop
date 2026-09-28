import { pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

// Speech-to-text with word timestamps, fully in the browser. The model is downloaded from
// Hugging Face the first time and cached by the browser; the audio never leaves the machine.

export type WhisperModel = 'base' | 'small' | 'large';

const MODEL_IDS: Record<WhisperModel, string> = {
  base: 'onnx-community/whisper-base_timestamped',
  small: 'onnx-community/whisper-small_timestamped',
  // Much better with sung vocals; only practical on WebGPU (~560 MB in q4f16).
  large: 'onnx-community/whisper-large-v3-turbo_timestamped',
};

export interface WhisperRequest {
  audio: Float32Array; // 16 kHz mono
  model: WhisperModel;
  /** Whisper language name ("spanish", "english"…) or null to auto-detect. */
  language: string | null;
}

export type WhisperMessage =
  | { type: 'loading'; file: string; progress: number }
  | { type: 'device'; device: string }
  | { type: 'transcribing' }
  | { type: 'done'; words: { text: string; start: number; end: number }[] }
  | { type: 'error'; message: string };

const post = (m: WhisperMessage) => (self as unknown as Worker).postMessage(m);

let cached: { model: WhisperModel; pipe: AutomaticSpeechRecognitionPipeline } | null = null;

async function load(model: WhisperModel): Promise<AutomaticSpeechRecognitionPipeline> {
  if (cached?.model === model) return cached.pipe;
  const id = MODEL_IDS[model];
  const progress_callback = (p: { status: string; file?: string; progress?: number }) => {
    if (p.status === 'progress' && p.file) post({ type: 'loading', file: p.file, progress: p.progress ?? 0 });
  };
  const adapter = 'gpu' in navigator ? await (navigator as unknown as { gpu: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu.requestAdapter().catch(() => null) : null;
  if (model === 'large' && !adapter) throw new Error('El modelo de máxima precisión necesita WebGPU (probá Chrome o Edge actualizados).');
  const f16 = !!adapter?.features.has('shader-f16');
  const gpuDtype =
    model === 'large'
      ? f16
        ? { encoder_model: 'q4f16', decoder_model_merged: 'q4f16' }
        : { encoder_model: 'q4', decoder_model_merged: 'q4' }
      : { encoder_model: 'fp32', decoder_model_merged: 'q4' };
  let pipe: AutomaticSpeechRecognitionPipeline;
  try {
    if (!adapter) throw new Error('no webgpu');
    pipe = (await pipeline('automatic-speech-recognition', id, {
      device: 'webgpu',
      dtype: gpuDtype as never,
      progress_callback,
    })) as AutomaticSpeechRecognitionPipeline;
    post({ type: 'device', device: 'WebGPU' });
  } catch (err) {
    if (model === 'large') throw err;
    pipe = (await pipeline('automatic-speech-recognition', id, { device: 'wasm', dtype: 'q8', progress_callback })) as AutomaticSpeechRecognitionPipeline;
    post({ type: 'device', device: 'CPU (WASM)' });
  }
  cached = { model, pipe };
  return pipe;
}

/** Whisper's usual inventions over instrumental parts. */
const HALLUCINATION = /(subt[ií]tulos|amara\.org|gracias por ver|suscr[ií]bete|thank you for watching|♪|🎵)/i;

self.onmessage = async (e: MessageEvent<WhisperRequest>) => {
  try {
    const { audio, model, language } = e.data;
    const pipe = await load(model);
    post({ type: 'transcribing' });
    const out = (await pipe(audio, {
      return_timestamps: 'word',
      chunk_length_s: 30,
      stride_length_s: 5,
      task: 'transcribe',
      ...(language ? { language } : {}),
    })) as { chunks?: { text: string; timestamp: [number, number | null] }[] };
    const words = (out.chunks ?? [])
      .map((c) => ({ text: c.text.trim(), start: c.timestamp[0], end: c.timestamp[1] ?? c.timestamp[0] + 0.3 }))
      .filter((w) => w.text && !HALLUCINATION.test(w.text));
    post({ type: 'done', words });
  } catch (err) {
    post({ type: 'error', message: (err as Error).message ?? String(err) });
  }
};
