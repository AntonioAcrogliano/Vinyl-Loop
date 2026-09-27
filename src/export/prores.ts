import type { ExportJob, ExportResult } from './common';
import { exportWithFFmpeg } from './ffmpeg';

/** ProRes 4444 with alpha (.mov): what Premiere / DaVinci / Final Cut import most reliably. */
export function exportProRes(job: ExportJob): Promise<ExportResult> {
  return exportWithFFmpeg(job, {
    ext: 'mov',
    mime: 'video/quicktime',
    stage: 'Codificando ProRes 4444',
    args: [
      '-c:v', 'prores_ks',
      '-profile:v', '4444',
      '-pix_fmt', 'yuva444p10le',
      '-alpha_bits', '16',
      '-vendor', 'apl0',
      '-bits_per_mb', '8000',
    ],
  });
}
