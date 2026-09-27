import { useState } from 'react';
import type { Direction, LayoutId, SceneConfig, VinylStyle } from '../render/types';
import { Check, ColorField, Section, Segmented, Slider, pct } from './widgets';

interface Props {
  cfg: SceneConfig;
  update: (patch: Partial<SceneConfig>) => void;
}

export const FORMATS: { id: string; label: string; sub: string; w: number; h: number }[] = [
  { id: '1:1', label: '1:1', sub: '1080²', w: 1080, h: 1080 },
  { id: '16:9', label: '16:9', sub: '1080p', w: 1920, h: 1080 },
  { id: '9:16', label: '9:16', sub: 'Stories', w: 1080, h: 1920 },
  { id: '4k', label: '4K', sub: '16:9', w: 3840, h: 2160 },
];

/** Default "how much sticks out" per layout. */
const LAYOUT_DISC_OUT: Record<LayoutId, number> = { semi: 0.5, side: 0.88, solo: 0.5 };

const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);

/** Tiny pictograms for the layout picker. */
function LayoutIcon({ id }: { id: LayoutId }) {
  const disc = id === 'semi' ? 21 : id === 'side' ? 29 : 18;
  return (
    <svg width="40" height="26" viewBox="0 0 40 26" aria-hidden>
      <circle cx={disc} cy="13" r="10" fill="currentColor" opacity="0.55" />
      {id !== 'solo' && <rect x="3" y="2" width="22" height="22" rx="1.5" fill="currentColor" />}
      {id === 'solo' && <rect x="3" y="2" width="22" height="22" rx="1.5" fill="none" stroke="currentColor" strokeDasharray="2 2" opacity="0.6" />}
    </svg>
  );
}

export function ScenePanel({ cfg, update }: Props) {
  const current = FORMATS.find((f) => f.w === cfg.width && f.h === cfg.height);
  const [custom, setCustom] = useState(!current);
  const vinyl = (patch: Partial<SceneConfig['vinyl']>) => update({ vinyl: { ...cfg.vinyl, ...patch } });
  const sleeve = (patch: Partial<SceneConfig['sleeve']>) => update({ sleeve: { ...cfg.sleeve, ...patch } });

  return (
    <>
      <Section title="Formato del video">
        <div className="format-grid" role="radiogroup" aria-label="Formato">
          {FORMATS.map((f) => {
            const on = !custom && f === current;
            return (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={on}
                className={on ? 'format on' : 'format'}
                onClick={() => {
                  setCustom(false);
                  update({ width: f.w, height: f.h });
                }}
              >
                <i style={{ aspectRatio: `${f.w} / ${f.h}` }} />
                <b>{f.label}</b>
                <small>{f.sub}</small>
              </button>
            );
          })}
          <button type="button" role="radio" aria-checked={custom} className={custom ? 'format on' : 'format'} onClick={() => setCustom(true)}>
            <i className="custom" />
            <b>Custom</b>
            <small>
              {cfg.width}×{cfg.height}
            </small>
          </button>
        </div>
        {custom && (
          <div className="row pair">
            <span>Ancho × alto</span>
            <input
              type="number"
              min={2}
              max={7680}
              step={2}
              defaultValue={cfg.width}
              aria-label="Ancho"
              onBlur={(e) => update({ width: Math.min(7680, even(Number(e.target.value) || 2)) })}
            />
            <input
              type="number"
              min={2}
              max={7680}
              step={2}
              defaultValue={cfg.height}
              aria-label="Alto"
              onBlur={(e) => update({ height: Math.min(7680, even(Number(e.target.value) || 2)) })}
            />
          </div>
        )}
        {custom && <p className="hint">Se redondea a números pares (H.264 lo necesita).</p>}
      </Section>

      <Section title="Composición">
        <Segmented<LayoutId>
          full
          value={cfg.layout}
          options={[
            { value: 'semi', label: <span className="stack"><LayoutIcon id="semi" />Semi-afuera</span> },
            { value: 'side', label: <span className="stack"><LayoutIcon id="side" />Al lado</span> },
            { value: 'solo', label: <span className="stack"><LayoutIcon id="solo" />Disco solo</span> },
          ]}
          onChange={(layout) => update({ layout, discOut: LAYOUT_DISC_OUT[layout] })}
        />
        <Segmented<Direction>
          label="Sale hacia"
          value={cfg.direction}
          options={[
            { value: 'left', label: '←', title: 'Izquierda' },
            { value: 'up', label: '↑', title: 'Arriba' },
            { value: 'right', label: '→', title: 'Derecha' },
          ]}
          onChange={(direction) => update({ direction })}
        />
        {cfg.layout === 'solo' && (
          <Segmented<'slide' | 'fade'>
            label="El sobre se va"
            value={cfg.soloSleeveExit}
            options={[
              { value: 'slide', label: 'Deslizando' },
              { value: 'fade', label: 'Fundido' },
            ]}
            onChange={(soloSleeveExit) => update({ soloSleeveExit })}
          />
        )}
        <Slider label="Tamaño" value={cfg.sleeveSize} min={0.3} max={0.9} step={0.01} onChange={(sleeveSize) => update({ sleeveSize })} format={pct} />
        {cfg.layout !== 'solo' && (
          <Slider
            label="Cuánto asoma"
            value={cfg.discOut}
            min={cfg.layout === 'side' ? 0.7 : 0.1}
            max={cfg.layout === 'side' ? 1 : 0.9}
            step={0.01}
            onChange={(discOut) => update({ discOut })}
            format={pct}
          />
        )}
        <Slider label="Posición X" value={cfg.offsetX} min={-0.3} max={0.3} step={0.005} onChange={(offsetX) => update({ offsetX })} format={pct} />
        <Slider label="Posición Y" value={cfg.offsetY} min={-0.3} max={0.3} step={0.005} onChange={(offsetY) => update({ offsetY })} format={pct} />
        <Slider label="Sombra" value={cfg.shadow} min={0} max={1} step={0.01} onChange={(shadow) => update({ shadow })} format={pct} />
      </Section>

      <Section title="Vinilo">
        <Segmented<VinylStyle>
          full
          value={cfg.vinyl.style}
          options={[
            { value: 'black', label: 'Negro' },
            { value: 'color', label: 'Color' },
            { value: 'translucent', label: 'Translúcido' },
          ]}
          onChange={(style) => vinyl({ style })}
        />
        {cfg.vinyl.style !== 'black' && <ColorField label="Color del vinilo" value={cfg.vinyl.color} onChange={(color) => vinyl({ color })} />}
        <Slider label="Brillo" value={cfg.vinyl.sheen} min={0} max={1} step={0.01} onChange={(sheen) => vinyl({ sheen })} format={pct} />
        <Slider label="Galleta" value={cfg.vinyl.labelSize} min={0.2} max={0.45} step={0.005} onChange={(labelSize) => vinyl({ labelSize })} format={pct} />
        <Slider label="Wobble" value={cfg.vinyl.wobble} min={0} max={1} step={0.01} onChange={(wobble) => vinyl({ wobble })} format={pct} />
      </Section>

      <Section title="Sobre">
        <Slider label="Desgaste" value={cfg.sleeve.wear} min={0} max={1} step={0.01} onChange={(wear) => sleeve({ wear })} format={(v) => String(Math.round(v * 100))} />
        <Check label="Funda interior de papel" checked={cfg.sleeve.innerSleeve} onChange={(innerSleeve) => sleeve({ innerSleeve })} />
      </Section>
    </>
  );
}
