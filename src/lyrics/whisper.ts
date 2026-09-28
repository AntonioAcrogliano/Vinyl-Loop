import { groupWords, type LyricLine } from './lyrics';
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

/**
 * Transcribes the song in a worker and groups the words into lines. Runs locally; only the
 * model files are downloaded (once, then cached by the browser).
 */
export async function transcribe(
  file: File,
  opts: { model: WhisperModel; language: string | null; onProgress: (p: TranscribeProgress) => void; signal?: AbortSignal },
): Promise<LyricLine[]> {
  opts.onProgress({ stage: 'decoding' });
  const audio = await toMono16k(file);
  const worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
  const files = new Map<string, number>();
  let device: string | undefined;
  try {
    return await new Promise<LyricLine[]>((resolve, reject) => {
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
          resolve(groupWords(m.words));
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
