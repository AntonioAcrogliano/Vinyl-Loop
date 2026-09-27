import { normalizeConfig, type SceneConfig } from '../render/types';

const KEY = 'vinilo-loop:presets:v1';

export interface PresetFile {
  app: 'vinilo-loop';
  version: 1;
  name: string;
  config: SceneConfig;
}

/** Presets store the whole config (never the images). Storage can fail (private mode): callers get {}. */
export function listPresets(): Record<string, SceneConfig> {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, Partial<SceneConfig>>) : {};
    return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, normalizeConfig(v)]));
  } catch {
    return {};
  }
}

function write(all: Record<string, SceneConfig>): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

export function savePreset(name: string, cfg: SceneConfig): boolean {
  return write({ ...listPresets(), [name]: cfg });
}

export function deletePreset(name: string): boolean {
  const all = listPresets();
  delete all[name];
  return write(all);
}

export function presetToJson(name: string, cfg: SceneConfig): string {
  const file: PresetFile = { app: 'vinilo-loop', version: 1, name, config: cfg };
  return JSON.stringify(file, null, 2);
}

export async function presetFromFile(file: File): Promise<{ name: string; config: SceneConfig }> {
  const data = JSON.parse(await file.text()) as Partial<PresetFile>;
  if (data.app !== 'vinilo-loop' || typeof data.config !== 'object' || !data.config) {
    throw new Error('El archivo no es un preset de Vinilo Loop.');
  }
  return { name: data.name || file.name.replace(/\.json$/i, ''), config: normalizeConfig(data.config) };
}
