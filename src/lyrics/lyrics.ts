// Timed lyrics: data model, LRC parsing / writing, and grouping of word timings into lines.

export interface LyricWord {
  /** Seconds from the start of the song. */
  start: number;
  end: number;
  text: string;
}

export interface LyricLine {
  /** Seconds from the start of the song. */
  start: number;
  /** Optional explicit end; otherwise the line lasts until the next one (see lineEnd). */
  end?: number;
  text: string;
  /** Word timings, when known (Whisper, enhanced LRC). Enables word-accurate karaoke fill. */
  words?: LyricWord[];
}

export type LyricsSource = 'lrclib' | 'whisper' | 'file' | 'manual';

export interface Lyrics {
  lines: LyricLine[];
  source: LyricsSource;
}

/** Lines sorted by start time, without empty ones (LRC uses empty lines as pauses). */
export function cleanLines(lines: LyricLine[]): LyricLine[] {
  return lines
    .filter((l) => l.text.trim() !== '' && Number.isFinite(l.start))
    .map((l) => ({ ...l, text: l.text.trim() }))
    .sort((a, b) => a.start - b.start);
}

/**
 * When a line stops being "current": its explicit end, else the next line's start, but never
 * longer than a reasonable singing time for its length (so instrumental gaps stay empty).
 */
export function lineEnd(lines: LyricLine[], i: number, nextStartOverride?: number): number {
  const l = lines[i];
  const next = nextStartOverride ?? lines[i + 1]?.start ?? Infinity;
  if (l.end !== undefined) return Math.min(l.end, next);
  const lastWord = l.words?.[l.words.length - 1]?.end;
  if (lastWord !== undefined) return Math.min(lastWord + 0.3, next);
  const guess = l.start + Math.max(2, Math.min(7, 0.75 + l.text.length * 0.11));
  return Math.min(guess, next);
}

// ---------- LRC ----------

const TIME = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
const WORD_TIME = /<(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)>/g;

function toSeconds(min: string, sec: string): number {
  return Number(min) * 60 + Number(sec.replace(':', '.'));
}

/**
 * Parses LRC, including multiple time tags per line ([00:12.00][01:30.00]text), the
 * [offset:±ms] header and "enhanced" word tags (<00:12.30>word).
 */
export function parseLrc(text: string): LyricLine[] {
  let offset = 0;
  const lines: LyricLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const off = /^\s*\[offset:\s*([+-]?\d+)\s*\]/i.exec(raw);
    if (off) {
      // LRC convention: a positive offset makes the lyrics appear sooner.
      offset = -Number(off[1]) / 1000;
      continue;
    }
    const times: number[] = [];
    let rest = raw;
    TIME.lastIndex = 0;
    let m: RegExpExecArray | null;
    let lastIndex = 0;
    while ((m = TIME.exec(raw)) && m.index === lastIndex) {
      times.push(toSeconds(m[1], m[2]));
      lastIndex = TIME.lastIndex;
    }
    if (!times.length) continue;
    rest = raw.slice(lastIndex);

    // Enhanced LRC word timings.
    let words: LyricWord[] | undefined;
    WORD_TIME.lastIndex = 0;
    if (WORD_TIME.test(rest)) {
      words = [];
      const parts = rest.split(/(<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>)/);
      let t = times[0];
      for (const p of parts) {
        const wm = /^<(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)>$/.exec(p);
        if (wm) t = toSeconds(wm[1], wm[2]);
        else if (p.trim()) words.push({ start: t, end: t, text: p.trim() });
      }
      for (let i = 0; i < words.length; i++) words[i].end = words[i + 1]?.start ?? words[i].start + 0.4;
      rest = rest.replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '');
    }
    const clean = rest.replace(/\s+/g, ' ').trim();
    for (const t of times) {
      const shift = t - times[0];
      lines.push({
        start: Math.max(0, t + offset),
        text: clean,
        words: words?.map((w) => ({ ...w, start: Math.max(0, w.start + shift + offset), end: Math.max(0, w.end + shift + offset) })),
      });
    }
  }
  return lines.sort((a, b) => a.start - b.start);
}

function stamp(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${String(m).padStart(2, '0')}:${rest.toFixed(2).padStart(5, '0')}`;
}

/** Writes LRC (enhanced word tags included when the line has word timings). */
export function toLrc(lines: LyricLine[], meta: { title?: string; artist?: string } = {}): string {
  const head: string[] = [];
  if (meta.title) head.push(`[ti:${meta.title}]`);
  if (meta.artist) head.push(`[ar:${meta.artist}]`);
  head.push('[re:Vinilo Loop]');
  const body = cleanLines(lines).map((l) => {
    const text = l.words?.length ? l.words.map((w) => `<${stamp(w.start)}>${w.text}`).join(' ') : l.text;
    return `[${stamp(l.start)}]${text}`;
  });
  return [...head, ...body].join('\n') + '\n';
}

/** Plain text → untimed lines (for tap-sync). */
export function linesFromText(text: string): LyricLine[] {
  return text
    .split(/\r?\n/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => ({ start: NaN, text: t }));
}

// ---------- Word timings → lines (Whisper) ----------

/**
 * Groups timed words into singable lines: breaks on pauses, sentence punctuation, or when a
 * line gets too long.
 */
export function groupWords(words: LyricWord[], opts: { maxChars?: number; pause?: number } = {}): LyricLine[] {
  const maxChars = opts.maxChars ?? 42;
  const pause = opts.pause ?? 0.7;
  const lines: LyricLine[] = [];
  let cur: LyricWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    lines.push({
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      text: cur.map((w) => w.text).join(' ').replace(/\s+([,.!?;:])/g, '$1'),
      words: cur,
    });
    cur = [];
  };
  for (const w of words) {
    const text = w.text.trim();
    if (!text) continue;
    const prev = cur[cur.length - 1];
    const len = cur.reduce((s, x) => s + x.text.length + 1, 0);
    if (prev && (w.start - prev.end > pause || len + text.length > maxChars)) flush();
    cur.push({ ...w, text });
    if (/[.!?¡¿…]$/.test(text) && cur.length >= 3) flush();
  }
  flush();
  return lines;
}
