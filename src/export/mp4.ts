import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, canEncodeVideo } from 'mediabunny';
import { addAudioTrack, writeAudio } from './audio';
import { ExportCancelled, canvasFactory, exportFilename, renderSequence, type ExportJob, type ExportResult } from './common';

/** ~30 Mbps at 1080p30, scaled by pixel rate. */
export function mp4Bitrate(width: number, height: number, fps: number): number {
  const ref = 1920 * 1080 * 30;
  const bps = 30e6 * ((width * height * fps) / ref);
  return Math.round(Math.min(120e6, Math.max(12e6, bps)));
}

export async function mp4Supported(width: number, height: number, fps: number): Promise<boolean> {
  if (typeof VideoEncoder === 'undefined') return false;
  try {
    return await canEncodeVideo('avc', { width, height, bitrate: mp4Bitrate(width, height, fps) });
  } catch {
    return false;
  }
}

export async function exportMp4(job: ExportJob): Promise<ExportResult> {
  const { cfg } = job;
  if (cfg.width % 2 || cfg.height % 2) throw new Error('H.264 requiere dimensiones pares.');
  if (!(await mp4Supported(cfg.width, cfg.height, cfg.fps))) {
    throw new Error(`Este navegador no puede codificar H.264 a ${cfg.width}×${cfg.height}. Probá Chrome/Edge o la secuencia PNG.`);
  }

  const canvas = canvasFactory(cfg.width, cfg.height);
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget(),
  });
  const source = new CanvasSource(canvas, {
    codec: 'avc',
    bitrate: mp4Bitrate(cfg.width, cfg.height, cfg.fps),
    keyFrameInterval: 2,
    latencyMode: 'quality',
  });
  output.addVideoTrack(source, { frameRate: cfg.fps });
  // AAC is what editors and social networks expect; Opus in MP4 as a fallback.
  const audio = await addAudioTrack(output, job, ['aac', 'opus']);
  await output.start();

  try {
    await writeAudio(audio);
    const frames = await renderSequence(
      job,
      async (_c, k) => {
        // Exact timestamps; the first frame is always a key frame.
        await source.add(k / cfg.fps, 1 / cfg.fps);
      },
      canvas,
    );
    await output.finalize();
    const buffer = (output.target as BufferTarget).buffer!;
    return {
      blob: new Blob([buffer], { type: 'video/mp4' }),
      filename: exportFilename(job, frames, 'mp4'),
    };
  } catch (err) {
    await output.cancel().catch(() => {});
    if (job.signal?.aborted) throw new ExportCancelled();
    throw err;
  }
}
