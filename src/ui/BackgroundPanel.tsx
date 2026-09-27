import { useEffect, useRef } from 'react';
import { BACKGROUNDS, getBackground, resolveParams, type Background } from '../render/backgrounds';
import type { Ctx2D, SceneConfig } from '../render/types';
import { Check, Section, Segmented, Slider, pct } from './widgets';

interface Props {
  cfg: SceneConfig;
  update: (patch: Partial<SceneConfig>) => void;
  photoPalette: string[] | null;
}

/** Live thumbnail of a background with the current palette (static phase). */
function BgThumb({ bg, palette, selected, onClick }: { bg: Background; palette: string[]; selected: boolean; onClick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = 76 * dpr;
    c.height = 48 * dpr;
    const ctx = c.getContext('2d') as Ctx2D;
    ctx.clearRect(0, 0, c.width, c.height);
    bg.draw(ctx, 0.15, c.width, c.height, palette, resolveParams(bg, {}));
  }, [bg, palette]);
  return (
    <button type="button" className={selected ? 'thumb bg on' : 'thumb bg'} onClick={onClick} aria-pressed={selected}>
      <canvas ref={ref} className={bg.transparent ? 'checker' : ''} style={{ width: 76, height: 48 }} />
      <span>{bg.label}</span>
    </button>
  );
}

export function BackgroundPanel({ cfg, update, photoPalette }: Props) {
  const bg = getBackground(cfg.background.id);
  const params = resolveParams(bg, cfg.background.params);
  const setBg = (patch: Partial<SceneConfig['background']>) => update({ background: { ...cfg.background, ...patch } });
  const palette = cfg.background.palette;
  const setParam = (key: string, v: number) => setBg({ params: { ...cfg.background.params, [key]: v } });

  return (
    <>
      <Section title="Fondo">
        <div className="thumbs bgs">
          {BACKGROUNDS.map((b) => (
            <BgThumb key={b.id} bg={b} palette={palette} selected={b.id === bg.id} onClick={() => setBg({ id: b.id })} />
          ))}
        </div>
        {bg.transparent && <p className="hint">Para exportar con transparencia usá WebM, PNG o ProRes.</p>}
        {bg.params?.map((d) =>
          d.options ? (
            <Segmented<number>
              key={d.key}
              label={d.label}
              value={params[d.key]}
              options={d.options.map((label, i) => ({ value: d.min + i, label }))}
              onChange={(v) => setParam(d.key, v)}
            />
          ) : (
            <Slider
              key={d.key}
              label={d.label}
              value={params[d.key]}
              min={d.min}
              max={d.max}
              step={d.step}
              onChange={(v) => setParam(d.key, v)}
              format={Number.isInteger(d.step) ? undefined : (v) => v.toFixed(2)}
            />
          ),
        )}
      </Section>

      {!bg.transparent && (
        <Section title="Colores">
          <div className="palette" role="group" aria-label="Paleta">
            {palette.map((c, i) => (
              <input
                key={i}
                type="color"
                value={c}
                disabled={cfg.background.paletteFromPhoto}
                title={`Color ${i + 1}`}
                aria-label={`Color ${i + 1}`}
                onChange={(e) => {
                  const next = palette.slice();
                  next[i] = e.target.value;
                  setBg({ palette: next });
                }}
              />
            ))}
          </div>
          <Check
            label="Colores desde la foto"
            checked={cfg.background.paletteFromPhoto}
            disabled={!photoPalette}
            onChange={(on) => setBg(on && photoPalette ? { paletteFromPhoto: true, palette: photoPalette } : { paletteFromPhoto: false })}
          />
          {!photoPalette && <p className="hint">Subí una foto para sacar la paleta de ahí.</p>}
        </Section>
      )}

      <Section title="Efectos">
        <Slider label="Grano" value={cfg.overlays.grain} min={0} max={1} step={0.01} onChange={(grain) => update({ overlays: { ...cfg.overlays, grain } })} format={pct} />
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
    </>
  );
}
