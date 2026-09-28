// Mixed-radix complex FFT (radices 2, 3, 4, 5 and generic), for sizes like 7680 = 2^9·3·5 that
// the vocal-separation STFT needs. Plans (factorization + twiddles) are built once per size.

export interface FftPlan {
  n: number;
  factors: number[];
  /** cos/sin of -2πk/n for k in [0, n). */
  cos: Float64Array;
  sin: Float64Array;
  /** Butterfly scratch (sized to the largest radix); safe to share, levels don't overlap. */
  sRe: Float64Array;
  sIm: Float64Array;
}

const plans = new Map<number, FftPlan>();

export function fftPlan(n: number): FftPlan {
  let p = plans.get(n);
  if (p) return p;
  const factors: number[] = [];
  let m = n;
  for (const f of [4, 2, 3, 5]) {
    while (m % f === 0) {
      factors.push(f);
      m /= f;
    }
  }
  for (let f = 7; m > 1; f += 2) {
    while (m % f === 0) {
      factors.push(f);
      m /= f;
    }
  }
  const cos = new Float64Array(n);
  const sin = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    cos[k] = Math.cos((-2 * Math.PI * k) / n);
    sin[k] = Math.sin((-2 * Math.PI * k) / n);
  }
  const maxR = Math.max(1, ...factors);
  p = { n, factors, cos, sin, sRe: new Float64Array(maxR), sIm: new Float64Array(maxR) };
  plans.set(n, p);
  return p;
}

/**
 * In-place-ish forward FFT: reads (re, im), writes (outRe, outIm). `inverse` conjugates the
 * twiddles and does NOT scale (divide by n yourself).
 */
export function fft(plan: FftPlan, re: Float64Array, im: Float64Array, outRe: Float64Array, outIm: Float64Array, inverse = false): void {
  rec(plan, re, im, 0, 1, outRe, outIm, 0, plan.n, 0, inverse ? -1 : 1);
}

function rec(
  p: FftPlan,
  re: Float64Array,
  im: Float64Array,
  inOff: number,
  stride: number,
  oRe: Float64Array,
  oIm: Float64Array,
  outOff: number,
  n: number,
  fi: number,
  sgn: number,
): void {
  if (n === 1) {
    oRe[outOff] = re[inOff];
    oIm[outOff] = im[inOff];
    return;
  }
  const r = p.factors[fi];
  const m = n / r;
  // Decimation in time: r sub-FFTs of size m over interleaved inputs.
  for (let q = 0; q < r; q++) rec(p, re, im, inOff + q * stride, stride * r, oRe, oIm, outOff + q * m, m, fi + 1, sgn);
  const tstep = p.n / n; // twiddle index step for this level
  const sRe = p.sRe;
  const sIm = p.sIm;
  for (let k = 0; k < m; k++) {
    // Load and twiddle the r values of butterfly k.
    for (let q = 0; q < r; q++) {
      const idx = outOff + q * m + k;
      const t = (q * k * tstep) % p.n;
      const c = p.cos[t];
      const s = sgn * p.sin[t];
      const xr = oRe[idx];
      const xi = oIm[idx];
      sRe[q] = xr * c - xi * s;
      sIm[q] = xr * s + xi * c;
    }
    if (r === 2) {
      oRe[outOff + k] = sRe[0] + sRe[1];
      oIm[outOff + k] = sIm[0] + sIm[1];
      oRe[outOff + m + k] = sRe[0] - sRe[1];
      oIm[outOff + m + k] = sIm[0] - sIm[1];
    } else if (r === 4) {
      const aRe = sRe[0] + sRe[2];
      const aIm = sIm[0] + sIm[2];
      const bRe = sRe[0] - sRe[2];
      const bIm = sIm[0] - sIm[2];
      const cRe = sRe[1] + sRe[3];
      const cIm = sIm[1] + sIm[3];
      // (x1 - x3) · (-i·sgn)
      const dRe = sgn * (sIm[1] - sIm[3]);
      const dIm = -sgn * (sRe[1] - sRe[3]);
      oRe[outOff + k] = aRe + cRe;
      oIm[outOff + k] = aIm + cIm;
      oRe[outOff + m + k] = bRe + dRe;
      oIm[outOff + m + k] = bIm + dIm;
      oRe[outOff + 2 * m + k] = aRe - cRe;
      oIm[outOff + 2 * m + k] = aIm - cIm;
      oRe[outOff + 3 * m + k] = bRe - dRe;
      oIm[outOff + 3 * m + k] = bIm - dIm;
    } else {
      // Generic small DFT of size r.
      for (let u = 0; u < r; u++) {
        let accRe = 0;
        let accIm = 0;
        for (let q = 0; q < r; q++) {
          const t = ((u * q * p.n) / r) % p.n;
          const c = p.cos[t];
          const s = sgn * p.sin[t];
          accRe += sRe[q] * c - sIm[q] * s;
          accIm += sRe[q] * s + sIm[q] * c;
        }
        oRe[outOff + u * m + k] = accRe;
        oIm[outOff + u * m + k] = accIm;
      }
    }
  }
}
