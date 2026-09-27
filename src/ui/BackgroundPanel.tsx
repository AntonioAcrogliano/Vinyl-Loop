import { BACKGROUNDS, getBackground, resolveParams } from '../render/backgrounds';
import type { SceneConfig } from '../render/types';
import { Check, Section, Select, Slider, pct } from './widgets';

interface Props {
  cfg: SceneConfig;
  update: (patch: Partial<SceneConfig>) => void;
  photoPalette: string[] | null;
}

export function BackgroundPanel({ cfg, update, photoPalette }: Props) {
  const bg = getBackground(cfg.background.id);
  const params = resolveParams(bg, cfg.background.params);
  const setBg = (patch: Partial<SceneConfig['background']>) => update({ background: { ...cfg.background, ...patch } });
  const palette = cfg.background.palette;
  const usesPalette = !bg.transparent;

  return (
    <Section title="Fondo">
      <Select
        label="Tipo"
        value={cfg.background.id}
        options={BACKGROUNDS.map((b) => ({ value: b.id, label: b.label }))}
        onChange={(id) => setBg({ id })}
      />
      {bg.params?.map((d) =>
        d.options ? (
          <Select
            key={d.key}
            label={d.label}
            value={params[d.key]}
            options={d.options.map((label, i) => ({ value: d.min + i, label }))}
            onChange={(v) => setBg({ params: { ...cfg.background.params, [d.key]: v } })}
          />
        ) : (
          <Slider
            key={d.key}
            label={d.label}
            value={params[d.key]}
            min={d.min}
            max={d.max}
            step={d.step}
            onChange={(v) => setBg({ params: { ...cfg.background.params, [d.key]: v } })}
            format={Number.isInteger(d.step) ? undefined : (v) => v.toFixed(2)}
          />
        ),
      )}
      {usesPalette && (
        <>
          <div className="row palette-row">
            <span>Paleta</span>
            <div className="palette">
              {palette.map((c, i) => (
                <input
                  key={i}
                  type="color"
                  value={c}
                  disabled={cfg.background.paletteFromPhoto}
                  title={`Color ${i + 1}`}
                  onChange={(e) => {
                    const next = palette.slice();
                    next[i] = e.target.value;
                    setBg({ palette: next });
                  }}
                />
              ))}
            </div>
          </div>
          <Check
            label="Colores desde la foto"
            checked={cfg.background.paletteFromPhoto}
            disabled={!photoPalette}
            onChange={(on) => setBg(on && photoPalette ? { paletteFromPhoto: true, palette: photoPalette } : { paletteFromPhoto: false })}
          />
          {!photoPalette && <p className="hint">Cargá una foto para sacar la paleta de ahí.</p>}
        </>
      )}
      <h3>Overlays</h3>
      <Slider
        label="Grano"
        value={cfg.overlays.grain}
        min={0}
        max={1}
        step={0.01}
        onChange={(grain) => update({ overlays: { ...cfg.overlays, grain } })}
        format={pct}
      />
      <Slider
        label="Viñeta"
        value={cfg.overlays.vignette}
        min={0}
        max={1}
        step={0.01}
        onChange={(vignette) => update({ overlays: { ...cfg.overlays, vignette } })}
        format={pct}
      />
    </Section>
  );
}
