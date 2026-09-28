import { cleanLines, linesFromText, parseLrc, type LyricLine } from './lyrics';

// LRCLIB (https://lrclib.net): free, open database of synced lyrics. Only the title, artist
// and duration are sent — never the audio.

const API = 'https://lrclib.net/api';

export interface LrclibResult {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

/**
 * Candidates with lyrics, closest duration first; among similar durations, synced ones first.
 * Plain (unsynced) lyrics are still useful: they can be aligned to the audio automatically.
 */
export async function searchLyrics(q: { title: string; artist: string; duration?: number }, signal?: AbortSignal): Promise<LrclibResult[]> {
  const params = new URLSearchParams({ track_name: q.title });
  if (q.artist) params.set('artist_name', q.artist);
  const res = await fetch(`${API}/search?${params}`, { signal });
  if (!res.ok) throw new Error(`LRCLIB respondió ${res.status}`);
  const all = (await res.json()) as LrclibResult[];
  const usable = all.filter((r) => !r.instrumental && (r.syncedLyrics || r.plainLyrics));
  const d = q.duration ?? 0;
  const score = (r: LrclibResult) => (d ? Math.round(Math.abs(r.duration - d) / 3) : 0) * 2 + (r.syncedLyrics ? 0 : 1);
  return usable.sort((a, b) => score(a) - score(b));
}

/** Synced lines, or untimed lines (start = NaN) when the entry only has plain lyrics. */
export function linesOf(r: LrclibResult): LyricLine[] {
  return r.syncedLyrics ? cleanLines(parseLrc(r.syncedLyrics)) : linesFromText(r.plainLyrics ?? '');
}

