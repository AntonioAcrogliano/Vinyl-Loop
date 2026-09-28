import type { LyricLine, LyricWord } from './lyrics';

// Forced alignment of known lyrics to a transcription: the user's text is right, Whisper's
// timings are right. A global sequence alignment (Needleman–Wunsch) pairs the words in order,
// tolerating misheard, missing and invented words; unpaired words get interpolated times.

/** Lowercase, no accents, no punctuation: "¡Canción!" → "cancion". */
export function normalizeWord(w: string): string {
  return w
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}']/gu, '')
    .replace(/'/g, '');
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = new Array(b.length + 1).fill(0).map((_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** 2 = same word, 1 = probably the same word misheard, -1 = different. */
function similarity(a: string, b: string): number {
  if (!a || !b) return -1;
  if (a === b) return 2;
  const d = editDistance(a, b);
  const ratio = 1 - d / Math.max(a.length, b.length);
  return ratio >= 0.6 ? 1 : -1;
}

const GAP = -1;

export interface AlignResult {
  lines: LyricLine[];
  /** Fraction of the lyric words paired with a transcribed word (0..1). */
  matched: number;
}

/**
 * Gives every line (and word) of `lines` a time taken from the transcribed `words`.
 * Lines keep their text exactly; times come from the paired words.
 */
export function alignLyrics(lines: { text: string }[], words: LyricWord[]): AlignResult {
  // Lyric tokens, remembering their line and original spelling.
  const tokens: { line: number; text: string; norm: string }[] = [];
  lines.forEach((l, li) => {
    for (const w of l.text.split(/\s+/)) {
      const norm = normalizeWord(w);
      if (norm) tokens.push({ line: li, text: w, norm });
    }
  });
  const heard = words.map((w) => ({ ...w, norm: normalizeWord(w.text) })).filter((w) => w.norm);
  const n = tokens.length;
  const m = heard.length;
  if (!n || !m) return { lines: lines.map((l) => ({ start: NaN, text: l.text })), matched: 0 };

  // Needleman–Wunsch: score matrix (rolling rows) + full traceback (0 diag, 1 up, 2 left).
  const trace = new Uint8Array((n + 1) * (m + 1));
  let prev = new Float64Array(m + 1);
  let cur = new Float64Array(m + 1);
  for (let j = 1; j <= m; j++) {
    prev[j] = j * GAP;
    trace[j] = 2;
  }
  for (let i = 1; i <= n; i++) {
    cur[0] = i * GAP;
    trace[i * (m + 1)] = 1;
    for (let j = 1; j <= m; j++) {
      const diag = prev[j - 1] + similarity(tokens[i - 1].norm, heard[j - 1].norm);
      const up = prev[j] + GAP;
      const left = cur[j - 1] + GAP;
      let best = diag;
      let dir = 0;
      if (up > best) {
        best = up;
        dir = 1;
      }
      if (left > best) {
        best = left;
        dir = 2;
      }
      cur[j] = best;
      trace[i * (m + 1) + j] = dir;
    }
    [prev, cur] = [cur, prev];
  }

  // Traceback: which heard word each lyric token got (only real matches count).
  const pair = new Int32Array(n).fill(-1);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const dir = trace[i * (m + 1) + j];
    if (dir === 0) {
      if (similarity(tokens[i - 1].norm, heard[j - 1].norm) > 0) pair[i - 1] = j - 1;
      i--;
      j--;
    } else if (dir === 1) i--;
    else j--;
  }

  // Token times: paired → the heard word; unpaired → interpolated between paired neighbours.
  const start = new Float64Array(n).fill(NaN);
  const end = new Float64Array(n).fill(NaN);
  let paired = 0;
  for (let k = 0; k < n; k++) {
    if (pair[k] >= 0) {
      start[k] = heard[pair[k]].start;
      end[k] = heard[pair[k]].end;
      paired++;
    }
  }
  if (!paired) return { lines: lines.map((l) => ({ start: NaN, text: l.text })), matched: 0 };
  const known = [...Array(n).keys()].filter((k) => pair[k] >= 0);
  const WORD = 0.35; // typical sung word length when extrapolating (s)
  for (let k = 0; k < n; k++) {
    if (pair[k] >= 0) continue;
    let before = known.filter((q) => q < k).pop();
    let after = known.find((q) => q > k);
    // Prefer neighbours in the same line: a missed first word sits right before the second
    // one, not in the middle of the pause between lines (and vice versa for a last word).
    const line = tokens[k].line;
    if (after !== undefined && tokens[after].line === line && (before === undefined || tokens[before].line !== line)) before = undefined;
    else if (before !== undefined && tokens[before].line === line && (after === undefined || tokens[after].line !== line)) after = undefined;
    if (before !== undefined && after !== undefined) {
      const u = (k - before) / (after - before);
      start[k] = end[before] + (start[after] - end[before]) * u;
      end[k] = Math.min(start[after], start[k] + WORD);
    } else if (before !== undefined) {
      start[k] = end[before] + (k - before - 1) * WORD;
      end[k] = start[k] + WORD;
    } else {
      start[k] = Math.max(0, start[after!] - (after! - k) * WORD);
      end[k] = start[k] + WORD;
    }
  }

  const out: LyricLine[] = lines.map((l) => ({ start: NaN, text: l.text, words: [] as LyricWord[] }));
  tokens.forEach((tk, k) => out[tk.line].words!.push({ start: start[k], end: Math.max(end[k], start[k] + 0.05), text: tk.text }));
  for (const l of out) {
    if (l.words!.length) {
      l.start = l.words![0].start;
      l.end = l.words![l.words!.length - 1].end;
    } else delete l.words;
  }
  return { lines: out, matched: paired / n };
}
