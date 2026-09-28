import { describe, expect, it } from 'vitest';
import { CHUNK, DIM_F, DIM_T, TRIM, istft, stft } from '../src/audio/mdx';

describe('MDX STFT / iSTFT', () => {
  it('an identity "model" gives back the (mono) signal inside the chunk', () => {
    const n = CHUNK + 4 * TRIM;
    const L = new Float32Array(n);
    const R = new Float32Array(n);
    // Band-limited content (well below the DIM_F cutoff of ~17.6 kHz at 44.1 kHz).
    for (let i = 0; i < n; i++) {
      L[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / 44100) + 0.2 * Math.sin((2 * Math.PI * 3100 * i) / 44100);
      R[i] = 0.3 * Math.sin((2 * Math.PI * 1234 * i) / 44100 + 1);
    }
    const start = TRIM;
    const spec = new Float32Array(4 * DIM_F * DIM_T);
    stft(L, R, start, spec);
    const back = istft(spec);
    let maxErr = 0;
    for (let i = TRIM; i < CHUNK - TRIM; i++) {
      const expected = (L[start + i] + R[start + i]) / 2;
      maxErr = Math.max(maxErr, Math.abs(back[i] - expected));
    }
    expect(maxErr).toBeLessThan(1e-4);
  });
});
