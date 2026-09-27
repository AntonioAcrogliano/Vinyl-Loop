import { AudioBufferSource, QUALITY_HIGH, canEncodeAudio, type AudioCodec, type Output } from 'mediabunny';
import { AUDIO_RATE, decodeSong, sliceBuffer } from '../audio/song';
import { framesFor, timingFor } from '../render/scene';
import type { ExportJob } from './common';

/**
 * Which part of the song goes with this export: the song starts with the intro, so an
 * export without the intro starts the audio where the loop starts. It lasts as long as the video.
 */
export function audioWindow(job: Pick<ExportJob, 'cfg' | 'plan'>): { start: number; duration: number } {
  const t = timingFor(job.cfg);
  const frames = framesFor(t, job.plan).length;
  return { start: job.plan.intro ? 0 : t.I / job.cfg.fps, duration: frames / job.cfg.fps };
}

export interface AudioTrack {
  source: AudioBufferSource;
  buffer: AudioBuffer;
  codec: AudioCodec;
}

/**
 * Decodes the song, cuts the window for this export and registers an audio track on the
 * output, using the first codec (in preference order) this browser can encode.
 */
export async function addAudioTrack(output: Output, job: ExportJob, codecs: AudioCodec[]): Promise<AudioTrack | null> {
  if (!job.audio) return null;
  job.onProgress?.(0, 1, 'Decodificando el audio');
  const full = await decodeSong(job.audio);
  const { start, duration } = audioWindow(job);
  const buffer = sliceBuffer(full, start, duration);
  for (const codec of codecs) {
    const ok = await canEncodeAudio(codec, { numberOfChannels: buffer.numberOfChannels, sampleRate: AUDIO_RATE }).catch(() => false);
    if (!ok) continue;
    const source = new AudioBufferSource({ codec, quality: QUALITY_HIGH });
    output.addAudioTrack(source);
    return { source, buffer, codec };
  }
  throw new Error(`Este navegador no puede codificar audio (${codecs.join(' / ')}). Exportá sin audio o probá Chrome.`);
}

/** Encodes the whole audio window. Call after output.start(). */
export async function writeAudio(track: AudioTrack | null): Promise<void> {
  if (!track) return;
  await track.source.add(track.buffer);
  track.source.close();
}
