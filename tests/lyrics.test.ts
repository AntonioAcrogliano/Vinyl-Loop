import { describe, expect, it } from 'vitest';
import { cleanLines, groupWords, lineEnd, linesFromText, parseLrc, toLrc } from '../src/lyrics/lyrics';

describe('LRC', () => {
  it('parses simple synced lyrics', () => {
    const l = parseLrc('[ti:Tema]\n[00:23.62] Ella durmió al calor de las masas\n[00:31.28] Y yo desperté\n[00:40.00]\n');
    expect(l.map((x) => x.start)).toEqual([23.62, 31.28, 40]);
    expect(l[0].text).toBe('Ella durmió al calor de las masas');
    expect(cleanLines(l)).toHaveLength(2);
  });

  it('handles repeated tags, 3-digit fractions and offsets', () => {
    const l = parseLrc('[offset:+500]\n[00:10.000][01:05.5]Estribillo\n[00:20.1]Verso');
    expect(l.map((x) => [x.start, x.text])).toEqual([
      [9.5, 'Estribillo'],
      [19.6, 'Verso'],
      [65, 'Estribillo'],
    ]);
  });

  it('reads enhanced word timings', () => {
    const [line] = parseLrc('[00:12.00]<00:12.00>Hola <00:12.50>mundo <00:13.20>lindo');
    expect(line.text).toBe('Hola mundo lindo');
    expect(line.words!.map((w) => w.start)).toEqual([12, 12.5, 13.2]);
    expect(line.words![1].end).toBe(13.2);
  });

  it('round-trips through toLrc', () => {
    const src = '[00:01.00]Uno\n[00:03.25]Dos\n[01:02.50]<01:02.50>Tres <01:03.00>palabras';
    const back = parseLrc(toLrc(parseLrc(src), { title: 'T', artist: 'A' }));
    expect(back.map((l) => [l.start, l.text])).toEqual([
      [1, 'Uno'],
      [3.25, 'Dos'],
      [62.5, 'Tres palabras'],
    ]);
    expect(back[2].words).toHaveLength(2);
  });

  it('plain text becomes untimed lines', () => {
    expect(linesFromText('a\n\n b \nc').map((l) => l.text)).toEqual(['a', 'b', 'c']);
  });
});

describe('line timing', () => {
  it('a line lasts until the next one, but not through long instrumental gaps', () => {
    const lines = cleanLines(parseLrc('[00:10.00]Corta\n[00:12.00]Otra línea\n[01:00.00]Después del solo'));
    expect(lineEnd(lines, 0)).toBe(12);
    expect(lineEnd(lines, 1)).toBeLessThan(20);
    expect(lineEnd(lines, 2)).toBeGreaterThan(60);
  });
});

describe('grouping Whisper words into lines', () => {
  const w = (start: number, text: string, dur = 0.3) => ({ start, end: start + dur, text });
  it('breaks on pauses, punctuation and length', () => {
    const words = [
      w(1, 'Ella'), w(1.4, 'durmió'), w(1.8, 'al'), w(2.1, 'calor.'),
      w(5, 'Y'), w(5.3, 'yo'), w(5.6, 'desperté'),
      w(9, 'una'), w(9.3, 'frase'), w(9.6, 'muy'), w(9.9, 'larga'), w(10.2, 'que'), w(10.5, 'no'), w(10.8, 'entra'), w(11.1, 'entera'), w(11.4, 'en'), w(11.7, 'una'), w(12, 'sola'), w(12.3, 'línea'),
    ];
    const lines = groupWords(words);
    expect(lines[0].text).toBe('Ella durmió al calor.');
    expect(lines[1].text).toBe('Y yo desperté');
    expect(lines.length).toBeGreaterThanOrEqual(4);
    for (const l of lines) expect(l.text.length).toBeLessThanOrEqual(42);
    expect(lines[1].words![0].start).toBe(5);
  });
});
