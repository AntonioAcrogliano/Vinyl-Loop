import { cleanLines, parseLrc, type LyricLine } from './lyrics';

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

export interface FoundLyrics {
  lines: LyricLine[];
  match: LrclibResult;
  /** Other synced candidates, best first (different versions of the song). */
  alternatives: LrclibResult[];
}

/** Candidates with synced lyrics, closest duration first. */
export async function searchLyrics(q: { title: string; artist: string; duration?: number }, signal?: AbortSignal): Promise<LrclibResult[]> {
  const params = new URLSearchParams({ track_name: q.title });
  if (q.artist) params.set('artist_name', q.artist);
  const res = await fetch(`${API}/search?${params}`, { signal });
  if (!res.ok) throw new Error(`LRCLIB respondió ${res.status}`);
  const all = (await res.json()) as LrclibResult[];
  const synced = all.filter((r) => r.syncedLyrics && !r.instrumental);
  const d = q.duration;
  return d ? synced.sort((a, b) => Math.abs(a.duration - d) - Math.abs(b.duration - d)) : synced;
}

export function linesOf(r: LrclibResult): LyricLine[] {
  return cleanLines(parseLrc(r.syncedLyrics ?? ''));
}

/**
 * Best synced lyrics for a song. Versions whose duration differs by more than a few seconds
 * are likely other recordings (live, remaster) and are only offered as alternatives.
 */
export async function findLyrics(q: { title: string; artist: string; duration?: number }, signal?: AbortSignal): Promise<FoundLyrics | null> {
  const list = await searchLyrics(q, signal);
  if (!list.length) return null;
  return { lines: linesOf(list[0]), match: list[0], alternatives: list.slice(1, 8) };
}
