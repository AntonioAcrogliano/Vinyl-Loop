import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { audioWindow } from './audio';
import { ExportCancelled, exportFilename, type ExportJob, type ExportResult } from './common';
import { frameName, renderPngSequence } from './pngSequence';

/**
 * ffmpeg.wasm (single-thread core, so no COOP/COEP headers are needed). The ~32 MB core is
 * served from our own origin and only fetched the first time a format needs it.
 */
async function loadFFmpeg(signal?: AbortSignal): Promise<FFmpeg> {
  const [{ FFmpeg }, { default: coreURL }, { default: wasmURL }] = await Promise.all([
    import('@ffmpeg/ffmpeg'),
    import('@ffmpeg/core?url'),
    import('@ffmpeg/core/wasm?url'),
  ]);
  const ffmpeg = new FFmpeg();
  await ffmpeg.load({ coreURL, wasmURL }, { signal });
  return ffmpeg;
}

export interface FFmpegEncode {
  ext: string;
  mime: string;
  /** Output-side ffmpeg arguments (codec, pixel format, …). */
  args: string[];
  /** Audio codec arguments, used when the job has a song. */
  audioArgs: string[];
  stage: string;
}

/**
 * Renders PNG frames (with alpha) into ffmpeg's virtual FS, then encodes them.
 * Progress: rendering first, then ffmpeg's own progress.
 */
export async function exportWithFFmpeg(job: ExportJob, enc: FFmpegEncode): Promise<ExportResult> {
  const { cfg } = job;
  job.onProgress?.(0, 1, 'Cargando ffmpeg.wasm (~32 MB, solo la primera vez)');
  const ffmpeg = await loadFFmpeg(job.signal);
  const onAbort = () => ffmpeg.terminate();
  job.signal?.addEventListener('abort', onAbort);
  try {
    const writes: Promise<unknown>[] = [];
    let total = 0;
    const frames = await renderPngSequence(job, (k, n) => {
      total = n;
      return (png) => {
        writes.push(ffmpeg.writeFile(frameName(k, n), png));
      };
    });
    await Promise.all(writes);
    if (job.signal?.aborted) throw new ExportCancelled();

    const digits = frameName(0, total).length - 'frame_.png'.length;
    // The song goes in as a second input, cut to the export's window.
    let audioIn: string[] = [];
    let audioOut: string[] = [];
    if (job.audio) {
      const ext = /\.([a-z0-9]+)$/i.exec(job.audio.name)?.[1] ?? 'audio';
      const name = `song.${ext}`;
      await ffmpeg.writeFile(name, new Uint8Array(await job.audio.arrayBuffer()));
      const w = audioWindow(job);
      audioIn = ['-ss', w.start.toFixed(3), '-t', w.duration.toFixed(3), '-i', name];
      audioOut = ['-map', '0:v', '-map', '1:a', ...enc.audioArgs, '-shortest'];
    }
    ffmpeg.on('progress', ({ progress }) => {
      job.onProgress?.(Math.round(Math.min(1, Math.max(0, progress)) * frames), frames, enc.stage);
    });
    const out = `out.${enc.ext}`;
    const code = await ffmpeg.exec([
      '-framerate', String(cfg.fps),
      '-i', `frame_%0${digits}d.png`,
      ...audioIn,
      ...enc.args,
      ...audioOut,
      '-r', String(cfg.fps),
      out,
    ]);
    if (code !== 0) throw new Error(`ffmpeg terminó con código ${code}`);
    // Free the input frames before copying the output out of wasm memory.
    for (let k = 0; k < frames; k++) await ffmpeg.deleteFile(frameName(k, total));
    const data = (await ffmpeg.readFile(out)) as Uint8Array;
    return {
      blob: new Blob([data as BlobPart], { type: enc.mime }),
      filename: exportFilename(job, frames, enc.ext),
    };
  } catch (err) {
    if (job.signal?.aborted) throw new ExportCancelled();
    throw err;
  } finally {
    job.signal?.removeEventListener('abort', onAbort);
    ffmpeg.terminate();
  }
}
