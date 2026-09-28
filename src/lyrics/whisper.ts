import type { SeparateMessage } from '../audio/separate.worker';
import { alignLyrics, type AlignResult } from './align';
import { groupWords, type LyricLine, type LyricWord } from './lyrics';
import type { WhisperMessage, WhisperModel } from './whisper.worker';

export type { WhisperModel };

export const WHISPER_MODELS: Record<WhisperModel, { label: string; size: string; needsGpu?: boolean }> = {
  base: { label: 'Rápido', size: '~80 MB' },
  small: { label: 'Preciso', size: '~250 MB' },
  large: { label: 'Máxima precisión', size: '~560 MB', needsGpu: true },
};

/** Vocal isolation model (MDX-Net Kim_Vocal_2, MIT, from Ultimate Vocal Remover). */
const SEPARATION_MODEL = 'https://huggingface.co/ModernMube/HTDemucs_onnx/resolve/main/Kim_Vocal_2.onnx';

export interface TranscribeProgress {
  stage: 'decoding' | 'separator' | 'separating' | 'downloading' | 'transcribing';
  /** 0..1 when measurable. */
  progress?: number;
  device?: string;
}

export interface TranscribeOptions {
  model: WhisperModel;
  language: string | null;
  /** Separate the vocals from the music first (much better recognition on busy mixes). */
  isolate: boolean;
  onProgress: (p: TranscribeProgress) => void;
  signal?: AbortSignal;
}

export async function hasWebGpu(): Promise<boolean> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  return !!gpu && !!(await gpu.requestAdapter().catch(() => null));
}

// ---------- Audio preparation ----------

async function decodeAt(file: File, rate: number, channels: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(channels, 1, rate);
  return ctx.decodeAudioData(await file.arrayBuffer());
}

function mixdown(buf: AudioBuffer): Float32Array {
  if (buf.numberOfChannels === 1) return buf.getChannelData(0).slice();
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) out[i] += d[i] / buf.numberOfChannels;
  }
  return out;
}

/** Resamples mono PCM with the browser's resampler. */
async function resample(pcm: Float32Array, from: number, to: number): Promise<Float32Array> {
  const length = Math.ceil((pcm.length * to) / from);
  const ctx = new OfflineAudioContext(1, length, to);
  const buf = new AudioBuffer({ length: pcm.length, numberOfChannels: 1, sampleRate: from });
  buf.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  return (await ctx.startRendering()).getChannelData(0);
}

/** Isolated vocals (44.1 kHz mono) per song, kept for the session. */
const vocalsCache = new WeakMap<File, Float32Array>();

export function cachedVocals(file: File): Float32Array | null {
  return vocalsCache.get(file) ?? null;
}

async function isolateVocals(file: File, opts: TranscribeOptions): Promise<Float32Array> {
  const hit = vocalsCache.get(file);
  if (hit) return hit;
  opts.onProgress({ stage: 'decoding' });
  const buf = await decodeAt(file, 44100, 2);
  const left = buf.getChannelData(0).slice();
  const right = (buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0)).slice();
  const worker = new Worker(new URL('../audio/separate.worker.ts', import.meta.url), { type: 'module' });
  let device: string | undefined;
  try {
    const vocals = await new Promise<Float32Array>((resolve, reject) => {
      opts.signal?.addEventListener('abort', () => reject(new DOMException('Cancelado', 'AbortError')));
      worker.onmessage = (e: MessageEvent<SeparateMessage>) => {
        const m = e.data;
        if (m.type === 'download') opts.onProgress({ stage: 'separator', progress: m.progress });
        else if (m.type === 'device') device = m.device;
        else if (m.type === 'progress') opts.onProgress({ stage: 'separating', progress: m.done / m.total, device });
        else if (m.type === 'done') resolve(m.vocals);
        else if (m.type === 'error') reject(new Error(m.message));
      };
      worker.onerror = (e) => reject(new Error(e.message || 'Falló el separador de voz'));
      worker.postMessage({ left, right, modelUrl: SEPARATION_MODEL }, [left.buffer, right.buffer]);
    });
    vocalsCache.set(file, vocals);
    return vocals;
  } finally {
    worker.terminate();
  }
}

/** 16 kHz mono for Whisper: the isolated vocals, or the whole mix. */
async function whisperInput(file: File, opts: TranscribeOptions): Promise<Float32Array> {
  if (opts.isolate) return resample(await isolateVocals(file, opts), 44100, 16000);
  opts.onProgress({ stage: 'decoding' });
  return mixdown(await decodeAt(file, 16000, 1));
}

// ---------- Transcription ----------

/** Transcriptions already done in this session, per song file and settings. */
const cache = new WeakMap<File, Map<string, LyricWord[]>>();

/**
 * Timed words of the song, transcribed in a worker. Runs locally; only the model files are
 * downloaded (once, then cached by the browser). Repeated calls reuse the result.
 */
export async function transcribeWords(file: File, opts: TranscribeOptions): Promise<LyricWord[]> {
  const key = `${opts.model}|${opts.language ?? 'auto'}|${opts.isolate ? 'voz' : 'mezcla'}`;
  const hit = cache.get(file)?.get(key);
  if (hit) return hit;
  const words = await runWhisper(await whisperInput(file, opts), opts);
  if (!cache.has(file)) cache.set(file, new Map());
  cache.get(file)!.set(key, words);
  return words;
}

/** Transcription grouped into lines (when there is no text to align). */
export async function transcribe(file: File, opts: TranscribeOptions): Promise<LyricLine[]> {
  return groupWords(await transcribeWords(file, opts));
}

/** The user's lyrics, timed with the transcription (text kept exactly as given). */
export async function syncLyrics(file: File, lines: { text: string }[], opts: TranscribeOptions): Promise<AlignResult> {
  return alignLyrics(lines, await transcribeWords(file, opts));
}

async function runWhisper(audio: Float32Array, opts: TranscribeOptions): Promise<LyricWord[]> {
  const worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
  const files = new Map<string, number>();
  let device: string | undefined;
  try {
    return await new Promise<LyricWord[]>((resolve, reject) => {
      opts.signal?.addEventListener('abort', () => reject(new DOMException('Cancelado', 'AbortError')));
      worker.onmessage = (e: MessageEvent<WhisperMessage>) => {
        const m = e.data;
        if (m.type === 'loading') {
          files.set(m.file, m.progress);
          const vals = [...files.values()];
          opts.onProgress({ stage: 'downloading', progress: vals.reduce((a, b) => a + b, 0) / vals.length / 100, device });
        } else if (m.type === 'device') {
          device = m.device;
        } else if (m.type === 'transcribing') {
          opts.onProgress({ stage: 'transcribing', device });
        } else if (m.type === 'done') {
          resolve(m.words);
        } else if (m.type === 'error') {
          reject(new Error(m.message));
        }
      };
      worker.onerror = (e) => reject(new Error(e.message || 'Falló el worker de Whisper'));
      const copy = audio.slice();
      worker.postMessage({ audio: copy, model: opts.model, language: opts.language }, [copy.buffer]);
    });
  } finally {
    worker.terminate();
  }
}
