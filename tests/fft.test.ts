import { describe, expect, it } from 'vitest';
import { fft, fftPlan } from '../src/audio/fft';
import { mulberry32 } from '../src/utils/prng';

function dft(re: Float64Array, im: Float64Array, inverse = false) {
  const n = re.length;
  const oRe = new Float64Array(n);
  const oIm = new Float64Array(n);
  const s = inverse ? 1 : -1;
  for (let k = 0; k < n; k++) {
    for (let t = 0; t < n; t++) {
      const a = (s * 2 * Math.PI * k * t) / n;
      oRe[k] += re[t] * Math.cos(a) - im[t] * Math.sin(a);
      oIm[k] += re[t] * Math.sin(a) + im[t] * Math.cos(a);
    }
  }
  return [oRe, oIm];
}

describe('mixed-radix FFT', () => {
  for (const n of [1, 2, 3, 4, 5, 8, 12, 30, 60, 120, 7 * 4, 240, 7680 / 16]) {
    it(`matches the DFT for n = ${n}`, () => {
      const rand = mulberry32(n);
      const re = Float64Array.from({ length: n }, () => rand() * 2 - 1);
      const im = Float64Array.from({ length: n }, () => rand() * 2 - 1);
      const oRe = new Float64Array(n);
      const oIm = new Float64Array(n);
      fft(fftPlan(n), re, im, oRe, oIm);
      const [eRe, eIm] = dft(re, im);
      for (let k = 0; k < n; k++) {
        expect(oRe[k]).toBeCloseTo(eRe[k], 9);
        expect(oIm[k]).toBeCloseTo(eIm[k], 9);
      }
    });
  }

  it('round-trips at the separation size (7680) with the inverse', () => {
    const n = 7680;
    const rand = mulberry32(7);
    const re = Float64Array.from({ length: n }, () => rand() * 2 - 1);
    const im = new Float64Array(n);
    const fRe = new Float64Array(n);
    const fIm = new Float64Array(n);
    const bRe = new Float64Array(n);
    const bIm = new Float64Array(n);
    const plan = fftPlan(n);
    fft(plan, re, im, fRe, fIm);
    fft(plan, fRe, fIm, bRe, bIm, true);
    let maxErr = 0;
    for (let k = 0; k < n; k++) maxErr = Math.max(maxErr, Math.abs(bRe[k] / n - re[k]), Math.abs(bIm[k] / n));
    expect(maxErr).toBeLessThan(1e-9);
  });
});
