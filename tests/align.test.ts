import { describe, expect, it } from 'vitest';
import { alignLyrics, normalizeWord } from '../src/lyrics/align';
import { linesFromText } from '../src/lyrics/lyrics';

/** Fake transcription: one word every 0.5 s, with gaps between lines. */
function transcribeLike(lines: string[], opts: { drop?: string[]; replace?: Record<string, string>; extra?: [number, string][] } = {}) {
  const words: { start: number; end: number; text: string }[] = [];
  let t = 10;
  const truth: number[] = [];
  for (const line of lines) {
    truth.push(t);
    for (const w of line.split(' ')) {
      const n = normalizeWord(w);
      if (!opts.drop?.includes(n)) words.push({ start: t, end: t + 0.4, text: opts.replace?.[n] ?? w });
      t += 0.5;
    }
    t += 2;
  }
  for (const [at, text] of opts.extra ?? []) words.push({ start: at, end: at + 0.3, text });
  words.sort((a, b) => a.start - b.start);
  return { words, truth };
}

const SONG = [
  'Ella durmió al calor de las masas',
  'Y yo desperté queriendo soñarla',
  'Algún tiempo atrás pensé en escribirle',
  'Que nunca sorteé las trampas del amor',
  'De aquel amor de música ligera',
  'Nada nos libra, nada más queda',
];

describe('forced alignment', () => {
  it('normalizes words', () => {
    expect(normalizeWord('¡Canción!')).toBe('cancion');
    expect(normalizeWord('Soñarla,')).toBe('sonarla');
  });

  it('perfect transcription gives the exact line starts and word timings', () => {
    const { words, truth } = transcribeLike(SONG);
    const { lines, matched } = alignLyrics(linesFromText(SONG.join('\n')), words);
    expect(matched).toBe(1);
    lines.forEach((l, i) => expect(l.start).toBeCloseTo(truth[i], 6));
    expect(lines[0].words).toHaveLength(7);
    expect(lines[0].text).toBe(SONG[0]);
  });

  it('survives misheard, missing and invented words', () => {
    const { words, truth } = transcribeLike(SONG, {
      drop: ['durmio', 'algun', 'libra'],
      replace: { sonarla: 'soñarlo', escribirle: 'escribirte', trampas: 'trampa' },
      extra: [[5, 'gracias'], [20.9, 'yeah'], [40, 'oh']],
    });
    const { lines, matched } = alignLyrics(linesFromText(SONG.join('\n')), words);
    expect(matched).toBeGreaterThan(0.85);
    lines.forEach((l, i) => expect(Math.abs(l.start - truth[i])).toBeLessThan(0.6));
    // Text is always the user's, never Whisper's.
    expect(lines[1].text).toBe('Y yo desperté queriendo soñarla');
  });

  it('keeps a repeated chorus in order', () => {
    const chorus = 'De aquel amor de música ligera';
    const text = [SONG[0], chorus, SONG[1], chorus];
    const { words, truth } = transcribeLike(text);
    const { lines } = alignLyrics(linesFromText(text.join('\n')), words);
    expect(lines[1].start).toBeCloseTo(truth[1], 6);
    expect(lines[3].start).toBeCloseTo(truth[3], 6);
  });

  it('interpolates a line Whisper missed completely', () => {
    const { words, truth } = transcribeLike(SONG, { drop: 'algun tiempo atras pense en escribirle'.split(' ') });
    const { lines } = alignLyrics(linesFromText(SONG.join('\n')), words);
    expect(lines[2].start).toBeGreaterThan(lines[1].start);
    expect(lines[2].start).toBeLessThan(lines[3].start);
    expect(Math.abs(lines[2].start - truth[2])).toBeLessThan(2.5);
  });

  it('returns untimed lines when nothing matches', () => {
    const { lines, matched } = alignLyrics(linesFromText('hola\nmundo'), [{ start: 1, end: 2, text: 'xyz' }]);
    expect(matched).toBe(0);
    expect(Number.isNaN(lines[0].start)).toBe(true);
  });
});
