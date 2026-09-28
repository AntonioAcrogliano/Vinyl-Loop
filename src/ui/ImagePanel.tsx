import { useEffect, useMemo, useRef, useState } from 'react';
import { LABEL_PRESETS, drawLabelPreset, getLabelPreset, rpmText, type LabelTexts } from '../render/labels';
import type { CoverStyle, Crop, Ctx2D, ImageLike, LabelSource, SceneConfig, SleeveMaterial } from '../render/types';
import { CropEditor } from './CropEditor';
import { Icon } from './icons';
import { ColorField, Section, Segmented } from './widgets';

export interface LoadedImage {
  bitmap: ImageLike;
  name: string;
  /** Original file, kept to save the project. */
  blob: Blob;
}

interface Props {
  cfg: SceneConfig;
  update: (patch: Partial<SceneConfig>) => void;
  cover: LoadedImage | null;
  label: LoadedImage | null;
  onImage: (kind: 'cover' | 'label', file: File) => void;
}

export function DropZone({ text, sub, onFile, compact }: { text: string; sub?: string; onFile: (f: File) => void; compact?: boolean }) {
  const [over, setOver] = useState(false);
  return (
    <label
      className={['drop', over && 'over', compact && 'compact'].filter(Boolean).join(' ')}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
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
      <Icon name="upload" size={compact ? 16 : 22} />
      <span className="drop-text">{text}</span>
      {sub && <span className="drop-sub">{sub}</span>}
    </label>
  );
}

function LabelThumb({ id, color, texts, selected, onClick }: { id: string; color: string; texts: LabelTexts; selected: boolean; onClick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const s = 64 * dpr;
    c.width = s;
    c.height = s;
    const ctx = c.getContext('2d') as Ctx2D;
    ctx.clearRect(0, 0, s, s);
    drawLabelPreset(ctx, s / 2, s / 2, s / 2 - 1, id, color, texts);
    ctx.fillStyle = '#121214';
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.03, 0, Math.PI * 2);
    ctx.fill();
  }, [id, color, texts]);
  return (
    <button type="button" className={selected ? 'thumb on' : 'thumb'} onClick={onClick} title={getLabelPreset(id).name} aria-pressed={selected}>
      <canvas ref={ref} style={{ width: 64, height: 64 }} />
      <span>{getLabelPreset(id).name}</span>
    </button>
  );
}

const MATERIALS: { value: SleeveMaterial; label: string; swatch: string }[] = [
  { value: 'kraft', label: 'Kraft', swatch: '#b08555' },
  { value: 'white', label: 'Blanco', swatch: '#f1eee7' },
  { value: 'black', label: 'Negro', swatch: '#1d1d1f' },
  { value: 'color', label: 'Color', swatch: 'conic-gradient(#e63946, #f1c453, #2a9d8f, #1d3557, #e63946)' },
  { value: 'photo', label: 'Foto', swatch: 'linear-gradient(135deg, #f4a261, #6a0572)' },
];

export function ImagePanel({ cfg, update, cover, label, onImage }: Props) {
  const sleeve = (patch: Partial<SceneConfig['sleeve']>) => update({ sleeve: { ...cfg.sleeve, ...patch } });
  const lab = (patch: Partial<SceneConfig['label']>) => update({ label: { ...cfg.label, ...patch } });
  const texts: LabelTexts = useMemo(
    () => ({ title: cfg.label.title, subtitle: cfg.label.subtitle, rpm: rpmText(cfg.rpm) }),
    [cfg.label.title, cfg.label.subtitle, cfg.rpm],
  );
  const dieCut = cfg.sleeve.style === 'dieCut';
  const coverVisible = !dieCut || cfg.sleeve.material === 'photo';
  const labelImage = cfg.label.source === 'cover' ? cover : cfg.label.source === 'image' ? label : null;
  const preset = getLabelPreset(cfg.label.preset);

  return (
    <>
      <Section title="Foto">
        {cover ? (
          <DropZone compact text={cover.name} sub="Cambiar foto" onFile={(f) => onImage('cover', f)} />
        ) : (
          <DropZone text="Arrastrá tu foto o hacé clic" sub="JPG, PNG o WebP · no sale de tu compu" onFile={(f) => onImage('cover', f)} />
        )}
      </Section>

      <Section title="Portada">
        <Segmented<CoverStyle>
          full
          value={cfg.sleeve.style}
          options={[
            { value: 'full', label: 'Foto completa' },
            { value: 'dieCut', label: 'Sobre con agujero' },
          ]}
          onChange={(style) => sleeve({ style })}
        />
        {dieCut && (
          <>
            <div className="swatches" role="radiogroup" aria-label="Material del sobre">
              {MATERIALS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={cfg.sleeve.material === m.value}
                  className={cfg.sleeve.material === m.value ? 'swatch on' : 'swatch'}
                  onClick={() => sleeve({ material: m.value })}
                >
                  <i style={{ background: m.swatch }} />
                  {m.label}
                </button>
              ))}
            </div>
            {cfg.sleeve.material === 'color' && (
              <ColorField label="Color del sobre" value={cfg.sleeve.color} onChange={(color) => sleeve({ color })} />
            )}
            <p className="hint">Por el agujero se ve la galleta mientras el disco está adentro.</p>
          </>
        )}
        {coverVisible && cover && (
          <CropEditor image={cover.bitmap} crop={cfg.coverCrop} shape="square" onChange={(coverCrop: Crop) => update({ coverCrop })} />
        )}
        {coverVisible && !cover && <p className="hint">Sin foto se usa una tapa de ejemplo.</p>}
      </Section>

      <Section title="Galleta del disco">
        <Segmented<LabelSource>
          full
          value={cfg.label.source}
          options={[
            { value: 'preset', label: 'Diseño' },
            { value: 'cover', label: 'Foto de tapa' },
            { value: 'image', label: 'Otra imagen' },
          ]}
          onChange={(source) => lab({ source })}
        />
        {cfg.label.source === 'preset' && (
          <>
            <div className="thumbs">
              {LABEL_PRESETS.map((p) => (
                <LabelThumb
                  key={p.id}
                  id={p.id}
                  color={p.id === cfg.label.preset ? cfg.label.color : ''}
                  texts={texts}
                  selected={p.id === cfg.label.preset}
                  onClick={() => lab({ preset: p.id, color: '' })}
                />
              ))}
            </div>
            <label className="row text-row">
              <span>Título</span>
              <input type="text" value={cfg.label.title} maxLength={40} onChange={(e) => lab({ title: e.target.value })} />
            </label>
            <label className="row text-row">
              <span>Subtítulo</span>
              <input type="text" value={cfg.label.subtitle} maxLength={40} onChange={(e) => lab({ subtitle: e.target.value })} />
            </label>
            <ColorField
              label="Color base"
              value={cfg.label.color || preset.base}
              onChange={(color) => lab({ color })}
              onReset={cfg.label.color ? () => lab({ color: '' }) : undefined}
            />
          </>
        )}
        {cfg.label.source === 'image' && (
          <DropZone
            compact
            text={label ? label.name : 'Imagen para la galleta'}
            sub={label ? 'Cambiar imagen' : 'JPG, PNG o WebP'}
            onFile={(f) => onImage('label', f)}
          />
        )}
        {cfg.label.source !== 'preset' &&
          (labelImage ? (
            <CropEditor image={labelImage.bitmap} crop={cfg.labelCrop} shape="circle" onChange={(labelCrop: Crop) => update({ labelCrop })} />
          ) : (
            <p className="hint">Mientras no haya imagen se muestra el diseño “{preset.name}”.</p>
          ))}
      </Section>
    </>
  );
}
