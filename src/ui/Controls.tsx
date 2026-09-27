import { useState } from 'react';
import { describeLoop, type Timing } from '../render/timing';
import type { Crop, Direction, ImageLike, LayoutId, SceneConfig, VinylStyle } from '../render/types';
import { CropEditor } from './CropEditor';
import { Check, Section, Select, Slider, pct } from './widgets';

export interface LoadedImage {
  bitmap: ImageLike;
  name: string;
}

interface Props {
  cfg: SceneConfig;
  update: (patch: Partial<SceneConfig>) => void;
  timing: Timing;
  cover: LoadedImage | null;
  label: LoadedImage | null;
  onImage: (kind: 'cover' | 'label', file: File) => void;
}

const RPMS: [string, number][] = [
  ['33⅓', 100 / 3],
  ['45', 45],
  ['78', 78],
];

const FORMATS: [string, number, number][] = [
  ['1:1 · 1080×1080', 1080, 1080],
  ['16:9 · 1920×1080', 1920, 1080],
  ['9:16 · 1080×1920', 1080, 1920],
  ['4K 16:9 · 3840×2160', 3840, 2160],
];

/** Default "how much sticks out" per layout. */
const LAYOUT_DISC_OUT: Record<LayoutId, number> = { semi: 0.5, side: 0.88, solo: 0.5 };

const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);

function DropZone({ text, onFile }: { text: string; onFile: (f: File) => void }) {
  const [over, setOver] = useState(false);
  return (
    <label
      className={over ? 'drop over' : 'drop'}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
    >
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
      {text}
    </label>
  );
}

export function Controls(p: Props) {
  const { cfg, update, timing } = p;
  const rpmPreset = RPMS.find(([, v]) => Math.abs(v - cfg.rpm) < 1e-9);
  const [customRpm, setCustomRpm] = useState(!rpmPreset);
  const formatIdx = FORMATS.findIndex(([, w, h]) => w === cfg.width && h === cfg.height);
  const [customFormat, setCustomFormat] = useState(formatIdx < 0);
  const vinyl = (patch: Partial<SceneConfig['vinyl']>) => update({ vinyl: { ...cfg.vinyl, ...patch } });
  const sleeve = (patch: Partial<SceneConfig['sleeve']>) => update({ sleeve: { ...cfg.sleeve, ...patch } });

  return (
    <>
      <Section title="Imagen">
        <DropZone
          text={p.cover ? `${p.cover.name} · cambiar imagen` : 'Arrastrá una foto (JPG, PNG, WebP) o hacé clic'}
          onFile={(f) => p.onImage('cover', f)}
        />
        {p.cover && (
          <>
            <h3>Tapa (cuadrado)</h3>
            <CropEditor
              image={p.cover.bitmap}
              crop={cfg.coverCrop}
              shape="square"
              onChange={(coverCrop: Crop) => update({ coverCrop })}
            />
            <Check
              label="Usar otra imagen para la etiqueta"
              checked={cfg.useSeparateLabel}
              onChange={(useSeparateLabel) => update({ useSeparateLabel })}
            />
            {cfg.useSeparateLabel && (
              <DropZone
                text={p.label ? `${p.label.name} · cambiar etiqueta` : 'Imagen para la etiqueta'}
                onFile={(f) => p.onImage('label', f)}
              />
            )}
            <h3>Etiqueta (círculo)</h3>
            {cfg.useSeparateLabel && !p.label ? (
              <p className="hint">Cargá la imagen de la etiqueta.</p>
            ) : (
              <CropEditor
                image={(cfg.useSeparateLabel && p.label ? p.label : p.cover).bitmap}
                crop={cfg.useSeparateLabel ? cfg.labelCrop : cfg.coverCrop}
                shape="circle"
                onChange={(c: Crop) => update(cfg.useSeparateLabel ? { labelCrop: c } : { coverCrop: c })}
              />
            )}
            {!cfg.useSeparateLabel && <p className="hint">La etiqueta usa el mismo recorte que la tapa.</p>}
          </>
        )}
      </Section>

      <Section title="Formato">
        <label className="row">
          <span>Tamaño</span>
          <select
            value={customFormat ? 'custom' : String(formatIdx)}
            onChange={(e) => {
              if (e.target.value === 'custom') return setCustomFormat(true);
              setCustomFormat(false);
              const [, width, height] = FORMATS[Number(e.target.value)];
              update({ width, height });
            }}
          >
            {FORMATS.map(([name], i) => (
              <option key={name} value={i}>
                {name}
              </option>
            ))}
            <option value="custom">Custom</option>
          </select>
        </label>
        {customFormat && (
          <div className="row pair">
            <span>W × H</span>
            <input
              type="number"
              min={2}
              max={7680}
              step={2}
              defaultValue={cfg.width}
              onBlur={(e) => update({ width: Math.min(7680, even(Number(e.target.value) || 2)) })}
            />
            <input
              type="number"
              min={2}
              max={7680}
              step={2}
              defaultValue={cfg.height}
              onBlur={(e) => update({ height: Math.min(7680, even(Number(e.target.value) || 2)) })}
            />
          </div>
        )}
        <Select
          label="FPS"
          value={cfg.fps}
          options={[24, 25, 30, 60].map((f) => ({ value: f, label: String(f) }))}
          onChange={(fps) => update({ fps })}
        />
      </Section>

      <Section title="Movimiento">
        <label className="row">
          <span>RPM</span>
          <select
            value={customRpm ? 'custom' : String(rpmPreset?.[1] ?? 'custom')}
            onChange={(e) => {
              if (e.target.value === 'custom') return setCustomRpm(true);
              setCustomRpm(false);
              update({ rpm: Number(e.target.value) });
            }}
          >
            {RPMS.map(([name, v]) => (
              <option key={name} value={String(v)}>
                {name}
              </option>
            ))}
            <option value="custom">Custom</option>
          </select>
        </label>
        {customRpm && (
          <label className="row">
            <span>RPM custom</span>
            <input
              type="number"
              min={1}
              max={300}
              step={0.1}
              defaultValue={Number(cfg.rpm.toFixed(2))}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v >= 1 && v <= 300) update({ rpm: v });
              }}
            />
          </label>
        )}
        <Slider
          label="Duración del loop"
          value={cfg.targetLoopSeconds}
          min={1}
          max={30}
          step={0.5}
          onChange={(targetLoopSeconds) => update({ targetLoopSeconds })}
          format={(v) => `~${v} s`}
        />
        <Check label="Intro (el disco sale del sobre)" checked={cfg.introEnabled} onChange={(introEnabled) => update({ introEnabled })} />
        {cfg.introEnabled && (
          <Slider
            label="Duración intro"
            value={cfg.introSeconds}
            min={0.5}
            max={8}
            step={0.1}
            onChange={(introSeconds) => update({ introSeconds })}
            format={(v) => `${v.toFixed(1)} s`}
          />
        )}
        <Check label="Outro (el disco vuelve al sobre)" checked={cfg.outroEnabled} onChange={(outroEnabled) => update({ outroEnabled })} />
        {cfg.outroEnabled && (
          <Slider
            label="Duración outro"
            value={cfg.outroSeconds}
            min={0.5}
            max={8}
            step={0.1}
            onChange={(outroSeconds) => update({ outroSeconds })}
            format={(v) => `${v.toFixed(1)} s`}
          />
        )}
        <p className="loop-info">
          {describeLoop(timing)}
          {timing.I > 0 && ` · intro ${timing.I} f`}
          {timing.O > 0 && ` · outro ${timing.O} f`}
        </p>
      </Section>

      <Section title="Layout">
        <Select<LayoutId>
          label="Layout"
          value={cfg.layout}
          options={[
            { value: 'semi', label: 'Semi-afuera' },
            { value: 'side', label: 'Afuera al lado' },
            { value: 'solo', label: 'Disco solo' },
          ]}
          onChange={(layout) => update({ layout, discOut: LAYOUT_DISC_OUT[layout] })}
        />
        <Select<Direction>
          label="Sale hacia"
          value={cfg.direction}
          options={[
            { value: 'right', label: 'Derecha' },
            { value: 'left', label: 'Izquierda' },
            { value: 'up', label: 'Arriba' },
          ]}
          onChange={(direction) => update({ direction })}
        />
        {cfg.layout === 'solo' && (
          <Select<'slide' | 'fade'>
            label="El sobre se va"
            value={cfg.soloSleeveExit}
            options={[
              { value: 'slide', label: 'Deslizándose' },
              { value: 'fade', label: 'Desvaneciéndose' },
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
        <Select<VinylStyle>
          label="Color"
          value={cfg.vinyl.style}
          options={[
            { value: 'black', label: 'Negro clásico' },
            { value: 'color', label: 'Color sólido' },
            { value: 'translucent', label: 'Translúcido' },
          ]}
          onChange={(style) => vinyl({ style })}
        />
        {cfg.vinyl.style !== 'black' && (
          <label className="row">
            <span>Tono</span>
            <input type="color" value={cfg.vinyl.color} onChange={(e) => vinyl({ color: e.target.value })} />
          </label>
        )}
        <Slider label="Brillo" value={cfg.vinyl.sheen} min={0} max={1} step={0.01} onChange={(sheen) => vinyl({ sheen })} format={pct} />
        <Slider label="Etiqueta" value={cfg.vinyl.labelSize} min={0.2} max={0.45} step={0.005} onChange={(labelSize) => vinyl({ labelSize })} format={pct} />
        <Slider label="Wobble" value={cfg.vinyl.wobble} min={0} max={1} step={0.01} onChange={(wobble) => vinyl({ wobble })} format={pct} />
      </Section>

      <Section title="Sobre">
        <Slider label="Desgaste" value={cfg.sleeve.wear} min={0} max={1} step={0.01} onChange={(wear) => sleeve({ wear })} format={(v) => String(Math.round(v * 100))} />
        <Check label="Funda interior de papel" checked={cfg.sleeve.innerSleeve} onChange={(innerSleeve) => sleeve({ innerSleeve })} />
      </Section>
    </>
  );
}
