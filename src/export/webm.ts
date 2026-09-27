import { BufferTarget, CanvasSource, Output, WebMOutputFormat, canEncodeVideo } from 'mediabunny';
import { getBackground } from '../render/backgrounds';
import { addAudioTrack, writeAudio } from './audio';
import { ExportCancelled, canvasFactory, exportFilename, renderSequence, type ExportJob, type ExportResult } from './common';
import { exportWithFFmpeg } from './ffmpeg';
import { mp4Bitrate } from './mp4';

export async function webmNativeSupported(width: number, height: number, fps: number): Promise<boolean> {
  if (typeof VideoEncoder === 'undefined') return false;
  try {
    return await canEncodeVideo('vp9', { width, height, bitrate: mp4Bitrate(width, height, fps) });
  } catch {
    return false;
  }
}

/**
 * WebM. With WebCodecs VP9, Mediabunny encodes the alpha plane as side data (real transparency).
 * Without it, falls back to ffmpeg.wasm with VP8 (libvpx, yuva420p): libvpx-vp9 in the
 * single-thread wasm core crashes intermittently ("memory access out of bounds"), VP8 is stable
 * and also carries alpha in WebM.
 */
export async function exportWebm(job: ExportJob): Promise<ExportResult> {
  const { cfg } = job;
  const alpha = !!getBackground(cfg.background.id).transparent;
  if (!(await webmNativeSupported(cfg.width, cfg.height, cfg.fps))) {
    return exportWithFFmpeg(job, {
      ext: 'webm',
      mime: 'video/webm',
      stage: 'Codificando VP8 (ffmpeg.wasm)',
      args: [
        '-c:v', 'libvpx',
        '-pix_fmt', alpha ? 'yuva420p' : 'yuv420p',
        '-b:v', `${Math.round(mp4Bitrate(cfg.width, cfg.height, cfg.fps) / 1e6)}M`,
        '-auto-alt-ref', '0',
        '-deadline', 'good',
        '-cpu-used', '2',
      ],
      audioArgs: ['-c:a', 'libopus', '-b:a', '192k'],
    });
  }

  const canvas = canvasFactory(cfg.width, cfg.height);
  const output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() });
  const source = new CanvasSource(canvas, {
    codec: 'vp9',
    bitrate: mp4Bitrate(cfg.width, cfg.height, cfg.fps),
    keyFrameInterval: 2,
    latencyMode: 'quality',
    alpha: alpha ? 'keep' : 'discard',
  });
  output.addVideoTrack(source, { frameRate: cfg.fps });
  const audio = await addAudioTrack(output, job, ['opus', 'vorbis']);
  await output.start();
  try {
    await writeAudio(audio);
    const frames = await renderSequence(
      job,
      async (_c, k) => {
        await source.add(k / cfg.fps, 1 / cfg.fps);
      },
      canvas,
    );
    await output.finalize();
    return {
      blob: new Blob([(output.target as BufferTarget).buffer!], { type: 'video/webm' }),
      filename: exportFilename(job, frames, 'webm'),
    };
  } catch (err) {
    await output.cancel().catch(() => {});
    if (job.signal?.aborted) throw new ExportCancelled();
    throw err;
  }
}
