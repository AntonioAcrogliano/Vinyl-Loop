export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type CanvasFactory = (width: number, height: number) => AnyCanvas;
export type ImageLike = CanvasImageSource & { width: number; height: number };

export type Direction = 'right' | 'left' | 'up';
/** semi: disc half out · side: disc fully out, slightly overlapping · solo: sleeve leaves, loop is just the disc. */
export type LayoutId = 'semi' | 'side' | 'solo';
export type VinylStyle = 'black' | 'color' | 'translucent';

/** Square crop: center in normalized image coords, zoom ≥ 1 (1 = largest square that fits). */
export interface Crop {
  cx: number;
  cy: number;
  zoom: number;
}

export interface BackgroundConfig {
  id: string;
  palette: string[];
  /** Keep the palette in sync with the dominant colors of the photo. */
  paletteFromPhoto: boolean;
  /** Per-background parameters; missing keys fall back to the background's defaults. */
  params: Record<string, number>;
}

export interface SceneConfig {
  width: number;
  height: number;
  fps: number;
  rpm: number;
  targetLoopSeconds: number;
  introEnabled: boolean;
  introSeconds: number;
  outroEnabled: boolean;
  outroSeconds: number;
  layout: LayoutId;
  direction: Direction;
  /** How the sleeve leaves in the "solo" layout. */
  soloSleeveExit: 'slide' | 'fade';
  /** Sleeve side as a fraction of min(width, height). */
  sleeveSize: number;
  /** How much of the disc diameter sticks out of the sleeve in the loop, 0..1. */
  discOut: number;
  /** Group offset as a fraction of width / height. */
  offsetX: number;
  offsetY: number;
  background: BackgroundConfig;
  overlays: {
    /** Film grain strength 0..1 (re-seeded every frame, periodic with the loop). */
    grain: number;
    vignette: number;
  };
  vinyl: {
    style: VinylStyle;
    /** Used by the "color" and "translucent" styles. */
    color: string;
    /** Sheen intensity 0..1. */
    sheen: number;
    /** Label diameter as a fraction of the disc diameter. */
    labelSize: number;
    /** Warped-record wobble 0..1, once per turn. */
    wobble: number;
  };
  sleeve: {
    /** Ring wear and worn edges, 0..1. */
    wear: number;
    /** White paper inner sleeve peeking out of the opening. */
    innerSleeve: boolean;
  };
  /** Shadow intensity 0..1. */
  shadow: number;
  coverCrop: Crop;
  labelCrop: Crop;
  useSeparateLabel: boolean;
}

export interface Sprite {
  canvas: AnyCanvas;
  /** Extra margin around the shape, in output pixels. */
  pad: number;
}

/** Everything static, pre-rendered once for a given output size. */
export interface SceneAssets {
  width: number;
  height: number;
  /** Grooves + label + hole, drawn rotated each frame. */
  disc: AnyCanvas;
  sleeve: AnyCanvas;
  paper: AnyCanvas | null;
  discShadow: Sprite;
  sleeveShadow: Sprite;
  grainTiles: AnyCanvas[];
}

export const DEFAULT_CROP: Crop = { cx: 0.5, cy: 0.5, zoom: 1 };

export const DEFAULT_CONFIG: SceneConfig = {
  width: 1080,
  height: 1080,
  fps: 30,
  rpm: 100 / 3,
  targetLoopSeconds: 8,
  introEnabled: true,
  introSeconds: 2.5,
  outroEnabled: false,
  outroSeconds: 2.5,
  layout: 'semi',
  direction: 'right',
  soloSleeveExit: 'slide',
  sleeveSize: 0.6,
  discOut: 0.5,
  offsetX: 0,
  offsetY: 0,
  background: { id: 'solid', palette: ['#e9e4da', '#c8322d', '#1d3557', '#f1c453', '#2a9d8f'], paletteFromPhoto: false, params: {} },
  overlays: { grain: 0, vignette: 0 },
  vinyl: { style: 'black', color: '#b3202a', sheen: 0.6, labelSize: 0.33, wobble: 0 },
  sleeve: { wear: 0, innerSleeve: false },
  shadow: 0.6,
  coverCrop: DEFAULT_CROP,
  labelCrop: DEFAULT_CROP,
  useSeparateLabel: false,
};

/** Fills in fields missing from older presets / partial configs. */
export function normalizeConfig(c: Partial<SceneConfig>): SceneConfig {
  const d = DEFAULT_CONFIG;
  return {
    ...d,
    ...c,
    background: { ...d.background, ...c.background },
    overlays: { ...d.overlays, ...c.overlays },
    vinyl: { ...d.vinyl, ...c.vinyl },
    sleeve: { ...d.sleeve, ...c.sleeve },
  };
}
