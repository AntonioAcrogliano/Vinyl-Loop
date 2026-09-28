import { alignLyrics, type AlignResult } from './align';
import { groupWords, type LyricLine, type LyricWord } from './lyrics';
import type { WhisperMessage, WhisperModel } from './whisper.worker';

export type { WhisperModel };

export const WHISPER_MODELS: Record<WhisperModel, { label: string; size: string }> = {
  base: { label: 'Rápido', size: '~80 MB' },
  small: { label: 'Preciso', size: '~250 MB' },
};

export interface TranscribeProgress {
  stage: 'decoding' | 'downloading' | 'transcribing';
  /** 0..1 while downloading; undefined when not measurable. */
  progress?: number;
  device?: string;
}

/** Song → 16 kHz mono, what Whisper expects. */
async function toMono16k(file: File): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, 1, 16000);
  const buf = await ctx.decodeAudioData(await file.arrayBuffer());
  if (buf.numberOfChannels === 1) return buf.getChannelData(0);
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) out[i] += d[i] / buf.numberOfChannels;
  }
  return out;
}

export interface TranscribeOptions {
  model: WhisperModel;
  language: string | null;
  onProgress: (p: TranscribeProgress) => void;
  signal?: AbortSignal;
}

/** Transcriptions already done in this session, per song file and settings. */
const cache = new WeakMap<File, Map<string, LyricWord[]>>();

/**
 * Timed words of the song, transcribed in a worker. Runs locally; only the model files are
 * downloaded (once, then cached by the browser). Repeated calls reuse the result.
 */
export async function transcribeWords(file: File, opts: TranscribeOptions): Promise<LyricWord[]> {
  const key = `${opts.model}|${opts.language ?? 'auto'}`;
  const hit = cache.get(file)?.get(key);
  if (hit) return hit;
  const words = await runWorker(file, opts);
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

async function runWorker(file: File, opts: TranscribeOptions): Promise<LyricWord[]> {
  opts.onProgress({ stage: 'decoding' });
  const audio = await toMono16k(file);
  const worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
  const files = new Map<string, number>();
  let device: string | undefined;
  try {
    return await new Promise<LyricWord[]>((resolve, reject) => {
      const abort = () => reject(new DOMException('Cancelado', 'AbortError'));
      opts.signal?.addEventListener('abort', abort);
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
      worker.postMessage({ audio, model: opts.model, language: opts.language }, [audio.buffer]);
    });
  } finally {
    worker.terminate();
  }
}
