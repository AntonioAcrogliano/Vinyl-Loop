import { fft, fftPlan } from './fft';

// STFT / inverse STFT for the MDX-Net vocal model (same framing as torch.stft/istft with
// center=True and a periodic Hann window). Both channels share one complex FFT per frame.

// Kim_Vocal_2 settings (UVR model data): n_fft 7680, hop 1024, dim_f 3072, dim_t 2^8.
export const N_FFT = 7680;
export const HOP = 1024;
export const DIM_F = 3072;
export const DIM_T = 256;
export const CHUNK = HOP * (DIM_T - 1);
export const TRIM = N_FFT / 2;
export const GEN = CHUNK - 2 * TRIM;
export const COMPENSATE = 1.009;

const WINDOW = Float64Array.from({ length: N_FFT }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT));

/** Sample of the chunk with reflection at the chunk edges (torch.stft center=True). */
export function reflect(x: Float32Array, start: number, i: number): number {
  let k = i;
  if (k < 0) k = -k;
  if (k >= CHUNK) k = 2 * (CHUNK - 1) - k;
  return x[start + k] ?? 0;
}

/** STFT of both channels (packed as one complex FFT per frame) → model input [1,4,DIM_F,DIM_T]. */
export function stft(L: Float32Array, R: Float32Array, start: number, out: Float32Array): void {
  const plan = fftPlan(N_FFT);
  const re = new Float64Array(N_FFT);
  const im = new Float64Array(N_FFT);
  const zr = new Float64Array(N_FFT);
  const zi = new Float64Array(N_FFT);
  const plane = DIM_F * DIM_T;
  for (let t = 0; t < DIM_T; t++) {
    const c = t * HOP - N_FFT / 2;
    for (let i = 0; i < N_FFT; i++) {
      re[i] = reflect(L, start, c + i) * WINDOW[i];
      im[i] = reflect(R, start, c + i) * WINDOW[i];
    }
    fft(plan, re, im, zr, zi);
    for (let f = 0; f < DIM_F; f++) {
      const g = f === 0 ? 0 : N_FFT - f;
      // Unpack the two real signals: X = (Z[f] + conj Z[-f]) / 2, Y = (Z[f] - conj Z[-f]) / 2i.
      const lr = (zr[f] + zr[g]) / 2;
      const li = (zi[f] - zi[g]) / 2;
      const rr = (zi[f] + zi[g]) / 2;
      const ri = (zr[g] - zr[f]) / 2;
      const idx = f * DIM_T + t;
      out[idx] = lr;
      out[plane + idx] = li;
      out[2 * plane + idx] = rr;
      out[3 * plane + idx] = ri;
    }
  }
}

/** Inverse STFT of the predicted vocal spectrogram → mono chunk of CHUNK samples. */
export function istft(spec: Float32Array): Float32Array {
  const plan = fftPlan(N_FFT);
  const plane = DIM_F * DIM_T;
  const total = CHUNK + N_FFT;
  const acc = new Float64Array(total);
  const norm = new Float64Array(total);
  const yr = new Float64Array(N_FFT);
  const yi = new Float64Array(N_FFT);
  const or = new Float64Array(N_FFT);
  const oi = new Float64Array(N_FFT);
  for (let t = 0; t < DIM_T; t++) {
    yr.fill(0);
    yi.fill(0);
    for (let f = 0; f < DIM_F; f++) {
      const idx = f * DIM_T + t;
      const lr = spec[idx];
      const li = spec[plane + idx];
      const rr = spec[2 * plane + idx];
      const ri = spec[3 * plane + idx];
      // Y = L + i·R, with Hermitian halves so l and r come out real.
      yr[f] = lr - ri;
      yi[f] = li + rr;
      if (f > 0) {
        const g = N_FFT - f;
        yr[g] = lr + ri;
        yi[g] = -li + rr;
      }
    }
    fft(plan, yr, yi, or, oi, true);
    const pos = t * HOP;
    for (let i = 0; i < N_FFT; i++) {
      const w = WINDOW[i];
      // Mono vocals: average of both channels.
      acc[pos + i] += (((or[i] + oi[i]) / 2) * w) / N_FFT;
      norm[pos + i] += w * w;
    }
  }
  // Remove the center padding and normalize by the window envelope.
  const out = new Float32Array(CHUNK);
  for (let i = 0; i < CHUNK; i++) {
    const k = i + N_FFT / 2;
    out[i] = norm[k] > 1e-8 ? acc[k] / norm[k] : 0;
  }
  return out;
}

