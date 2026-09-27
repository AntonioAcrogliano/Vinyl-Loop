import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';

export interface Song {
  file: File;
  /** File name without extension (used for export file names). */
  name: string;
  duration: number;
  /** Object URL for preview playback. */
  url: string;
  /** From the file's tags, when present. */
  title?: string;
  artist?: string;
  /** Embedded cover art, when present. */
  cover?: Blob;
}

/** Reads duration and tags (title, artist, cover art) without decoding the whole file. */
export async function loadSong(file: File): Promise<Song> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('El archivo no tiene audio.');
    const duration = await input.computeDuration();
    if (!(duration > 0)) throw new Error('No pude leer la duración.');
    const tags = await input.getMetadataTags().catch(() => ({}) as Awaited<ReturnType<Input['getMetadataTags']>>);
    const img = tags.images?.find((i) => i.kind === 'coverFront') ?? tags.images?.[0];
    return {
      file,
      name: file.name.replace(/\.[^.]+$/, ''),
      duration,
      url: URL.createObjectURL(file),
      title: tags.title?.trim() || undefined,
      artist: (tags.artist || tags.albumArtist)?.trim() || undefined,
      cover: img ? new Blob([img.data as BlobPart], { type: img.mimeType }) : undefined,
    };
  } finally {
    input.dispose();
  }
}

export const AUDIO_RATE = 48000;

/** Decodes the whole song to 48 kHz PCM (stereo or mono, as the source). */
export async function decodeSong(file: File): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, 1, AUDIO_RATE);
  return ctx.decodeAudioData(await file.arrayBuffer());
}

/** Copy of [start, start + duration) seconds, padded with silence if the song is shorter. */
export function sliceBuffer(buf: AudioBuffer, start: number, duration: number): AudioBuffer {
  const sr = buf.sampleRate;
  const length = Math.max(1, Math.round(duration * sr));
  const out = new AudioBuffer({ length, numberOfChannels: buf.numberOfChannels, sampleRate: sr });
  const from = Math.round(start * sr);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const src = buf.getChannelData(ch).subarray(from, from + length);
    out.copyToChannel(src, ch, 0);
  }
  return out;
}
