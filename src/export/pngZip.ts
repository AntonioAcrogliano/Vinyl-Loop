import { Zip, ZipPassThrough } from 'fflate';
import { exportFilename, type ExportJob, type ExportResult } from './common';
import { frameName, renderPngSequence } from './pngSequence';

/** PNG sequence with real alpha, zipped without recompression (PNGs are already compressed). */
export async function exportPngZip(job: ExportJob): Promise<ExportResult> {
  const chunks: Uint8Array[] = [];
  let zipError: Error | null = null;
  let zipRef!: Zip;
  const done = new Promise<void>((resolve, reject) => {
    zipRef = new Zip((err, data, final) => {
      if (err) {
        zipError = err;
        reject(err);
        return;
      }
      chunks.push(data);
      if (final) resolve();
    });
  });
  done.catch(() => {}); // surfaced through zipError / the final await

  const frames = await renderPngSequence(job, (k, total) => {
    if (zipError) throw zipError;
    // Entries are added in order now; their data arrives when the worker finishes.
    const entry = new ZipPassThrough(frameName(k, total));
    zipRef.add(entry);
    return (png) => entry.push(png, true);
  });
  if (job.audio) {
    // The song travels with the frames, cut to the same window, so editors line it up at 0.
    const { encodeWav } = await import('../audio/wav');
    const { decodeSong, sliceBuffer } = await import('../audio/song');
    const { audioWindow } = await import('./audio');
    const w = audioWindow(job);
    const entry = new ZipPassThrough('audio.wav');
    zipRef.add(entry);
    entry.push(encodeWav(sliceBuffer(await decodeSong(job.audio), w.start, w.duration)), true);
  }
  zipRef.end();
  await done;
  return {
    blob: new Blob(chunks as BlobPart[], { type: 'application/zip' }),
    filename: exportFilename(job, frames, 'zip'),
  };
}
