import { encodePng } from '../utils/png';

interface Job {
  id: number;
  pixels: ArrayBuffer;
  width: number;
  height: number;
}

self.onmessage = (e: MessageEvent<Job>) => {
  const { id, pixels, width, height } = e.data;
  const png = encodePng(new Uint8Array(pixels), width, height, 1);
  (self as unknown as Worker).postMessage({ id, png }, [png.buffer]);
};
