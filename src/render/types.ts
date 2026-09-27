export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type CanvasFactory = (width: number, height: number) => AnyCanvas;
export type ImageLike = CanvasImageSource & { width: number; height: number };

export type Direction = 'right' | 'left' | 'up';
/** semi: disc half out · side: disc fully out, slightly overlapping · solo: sleeve leaves, loop is just the disc. */
export type LayoutId = 'semi' | 'side' | 'solo';
export type VinylStyle = 'black' | 'color' | 'translucent';
/** full: the photo is the whole jacket · dieCut: paper sleeve with a round hole showing the label. */
export type CoverStyle = 'full' | 'dieCut';
export type SleeveMaterial = 'kraft' | 'white' | 'black' | 'color' | 'photo';
/** cover: label uses the cover photo · image: a separate image · preset: a standard label design. */
export type LabelSource = 'cover' | 'image' | 'preset';
export type TextPosition = 'bottom' | 'bottomLeft' | 'top' | 'topLeft';
export type TextFont = 'sans' | 'serif' | 'condensed' | 'mono';
/** How the title card enters during the intro / leaves during the outro. */
export type TextAnim = 'none' | 'fade' | 'slide' | 'wipe' | 'typewriter' | 'letters';

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
    style: CoverStyle;
    /** Die-cut sleeve material. */
    material: SleeveMaterial;
    /** Used by the "color" material. */
    color: string;
    /** Ring wear and worn edges, 0..1. */
    wear: number;
    /** White paper inner sleeve peeking out of the opening. */
    innerSleeve: boolean;
  };
  /** Shadow intensity 0..1. */
  shadow: number;
  label: {
    source: LabelSource;
    /** Standard label design id (see labels.ts). */
    preset: string;
    /** Base color override for the preset; empty = the preset's own color. */
    color: string;
    title: string;
    subtitle: string;
  };
  /** Title card with the song name and artist. Static during the loop, animated in the intro / outro. */
  text: {
    enabled: boolean;
    title: string;
    artist: string;
    position: TextPosition;
    font: TextFont;
    /** Size multiplier, 1 = default. */
    size: number;
    color: string;
    uppercase: boolean;
    shadow: boolean;
    animIn: TextAnim;
    animOut: TextAnim;
  };
  coverCrop: Crop;
  labelCrop: Crop;
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
  /** Inside of the sleeve, seen through the die-cut hole (null for full covers). */
  sleeveBack: AnyCanvas | null;
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
  sleeve: { style: 'full', material: 'kraft', color: '#2f4858', wear: 0, innerSleeve: false },
  shadow: 0.6,
  coverCrop: DEFAULT_CROP,
  label: { source: 'cover', preset: 'classic', color: '', title: 'Vinilo Loop', subtitle: 'Lado A' },
  text: {
    enabled: false,
    title: 'Nombre del tema',
    artist: 'Artista',
    position: 'bottom',
    font: 'sans',
    size: 1,
    // Dark on the default cream background; switch to white (with shadow) on dark backgrounds.
    color: '#1c1c1e',
    uppercase: false,
    shadow: false,
    animIn: 'letters',
    animOut: 'fade',
  },
  labelCrop: DEFAULT_CROP,
};

/** Fills in fields missing from older presets / partial configs. */
export function normalizeConfig(c: Partial<SceneConfig> & { useSeparateLabel?: boolean }): SceneConfig {
  const d = DEFAULT_CONFIG;
  // Older presets had a boolean "useSeparateLabel" instead of label.source.
  const { useSeparateLabel, ...rest } = c;
  const label = { ...d.label, ...(useSeparateLabel ? { source: 'image' as const } : {}), ...c.label };
  return {
    ...d,
    ...rest,
    label,
    text: { ...d.text, ...c.text },
    background: { ...d.background, ...c.background },
    overlays: { ...d.overlays, ...c.overlays },
    vinyl: { ...d.vinyl, ...c.vinyl },
    sleeve: { ...d.sleeve, ...c.sleeve },
  };
}
