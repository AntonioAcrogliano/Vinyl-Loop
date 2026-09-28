import { useState } from 'react';
import { canvasFactory, downloadBlob } from '../export/common';
import type { SceneImages } from '../render/scene';
import { THUMB_H, THUMB_W, renderThumbnail } from '../render/thumbnail';
import type { SceneConfig, TextFont, ThumbConfig, ThumbLayout, ThumbTextStyle } from '../render/types';
import { Icon } from './icons';
import { Check, ColorField, Section, Segmented, Slider, pct } from './widgets';

interface Props {
  cfg: SceneConfig;
  update: (patch: Partial<SceneConfig>) => void;
  images: SceneImages;
  /** Base for the file name. */
  name: string;
}

const TAGS = ['Letra', 'Lyrics', 'Vinilo', 'Audio oficial'];

/** Pictogram of the layout: where the record and the text go. */
function LayoutIcon({ layout }: { layout: ThumbLayout }) {
  const disc = { left: 19, right: 9, bottom: 14, clean: 14 }[layout];
  const discY = layout === 'bottom' ? 8 : 11;
  const r = layout === 'bottom' ? 5 : 6.5;
  return (
    <svg width="30" height="22" viewBox="0 0 28 22" aria-hidden>
      <rect x="1" y="1" width="26" height="20" rx="2" fill="none" stroke="currentColor" opacity="0.5" />
      <circle cx={disc} cy={discY} r={r} fill="none" stroke="currentColor" strokeWidth="1.6" />
      {layout === 'left' && (
        <>
          <rect x="4" y="7" width="7" height="2.4" rx="1" fill="currentColor" />
          <rect x="4" y="11" width="6" height="2.4" rx="1" fill="currentColor" />
          <rect x="4" y="15" width="5" height="1.4" rx="0.7" fill="currentColor" opacity="0.7" />
        </>
      )}
      {layout === 'right' && (
        <>
          <rect x="17" y="7" width="7" height="2.4" rx="1" fill="currentColor" />
          <rect x="18" y="11" width="6" height="2.4" rx="1" fill="currentColor" />
          <rect x="19" y="15" width="5" height="1.4" rx="0.7" fill="currentColor" opacity="0.7" />
        </>
      )}
      {layout === 'bottom' && <rect x="7" y="15.5" width="14" height="2.4" rx="1" fill="currentColor" />}
    </svg>
  );
}

async function thumbnailBlob(cfg: SceneConfig, images: SceneImages, type: 'image/jpeg' | 'image/png'): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = THUMB_W;
  canvas.height = THUMB_H;
  renderThumbnail(canvas.getContext('2d')!, cfg, cfg.thumb, images, canvasFactory);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen'))), type, 0.92),
  );
}

export function ThumbPanel({ cfg, update, images, name }: Props) {
  const th = cfg.thumb;
  const set = (patch: Partial<ThumbConfig>) => update({ thumb: { ...th, ...patch } });
  const [msg, setMsg] = useState('');
  const hasText = th.layout !== 'clean';

  const download = async (type: 'image/jpeg' | 'image/png') => {
    try {
      const blob = await thumbnailBlob(cfg, images, type);
      const safe = name.replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'vinilo';
      const file = `${safe}_miniatura_${THUMB_W}x${THUMB_H}.${type === 'image/png' ? 'png' : 'jpg'}`;
      downloadBlob(blob, file);
      const mb = blob.size / 1e6;
      setMsg(
        `Listo: ${file} (${mb.toLocaleString('es-AR', { maximumFractionDigits: 2 })} MB)` +
          (mb > 2 ? '. Pesa más de 2 MB, el límite de YouTube: usá JPG.' : ''),
      );
    } catch (err) {
      setMsg((err as Error).message);
    }
  };

  return (
    <>
      <Section title="Miniatura para YouTube" hint="1280×720, el tamaño que pide YouTube.">
        <Segmented<ThumbLayout>
          label="Diseño"
          value={th.layout}
          options={(['left', 'right', 'bottom', 'clean'] as const).map((l) => ({
            value: l,
            label: <LayoutIcon layout={l} />,
            title: { left: 'Texto a la izquierda', right: 'Texto a la derecha', bottom: 'Texto abajo', clean: 'Sin texto' }[l],
          }))}
          onChange={(layout) => set({ layout })}
        />
        <Segmented<ThumbConfig['background']>
          label="Fondo"
          value={th.background}
          options={[
            { value: 'blur', label: 'Foto desenfocada', disabled: !images.cover, title: images.cover ? undefined : 'Cargá una foto primero' },
            { value: 'scene', label: 'El del video' },
          ]}
          onChange={(background) => set({ background })}
        />
        <Segmented<ThumbConfig['pose']>
          label="Vinilo"
          value={th.pose}
          options={[
            { value: 'out', label: 'Afuera' },
            { value: 'in', label: 'En la funda' },
          ]}
          onChange={(pose) => set({ pose })}
        />
        <Slider label="Tamaño del vinilo" value={th.recordSize} min={0.6} max={1.2} step={0.01} format={pct} onChange={(recordSize) => set({ recordSize })} />
      </Section>

      {hasText && (
        <Section title="Texto">
          <label className="row text-row">
            <span>Tema</span>
            <input type="text" value={th.title} placeholder={cfg.text.title} maxLength={80} onChange={(e) => set({ title: e.target.value })} />
          </label>
          <label className="row text-row">
            <span>Artista</span>
            <input type="text" value={th.artist} placeholder={cfg.text.artist} maxLength={80} onChange={(e) => set({ artist: e.target.value })} />
          </label>
          <label className="row text-row">
            <span>Etiqueta</span>
            <input type="text" value={th.tag} placeholder="Opcional" maxLength={30} onChange={(e) => set({ tag: e.target.value })} />
          </label>
          <div className="chips">
            {TAGS.map((t) => (
              <button key={t} type="button" className={th.tag === t ? 'chip on' : 'chip'} onClick={() => set({ tag: th.tag === t ? '' : t })}>
                {t}
              </button>
            ))}
          </div>
          <p className="hint">Si dejás Tema o Artista vacíos, se usa lo de la pestaña Texto.</p>
        </Section>
      )}

      {hasText && (
        <Section title="Estilo">
          <Segmented<TextFont>
            full
            value={th.font}
            options={[
              { value: 'condensed', label: <span style={{ fontFamily: 'Impact, "Arial Narrow", sans-serif' }}>Impacto</span> },
              { value: 'sans', label: <span style={{ fontFamily: '"Arial Black", Arial, sans-serif', fontWeight: 900 }}>Gruesa</span> },
              { value: 'serif', label: <span style={{ fontFamily: 'Georgia, serif', fontWeight: 700 }}>Serif</span> },
              { value: 'mono', label: <span style={{ fontFamily: '"Courier New", monospace', fontWeight: 700 }}>Mono</span> },
            ]}
            onChange={(font) => set({ font })}
          />
          <Segmented<ThumbTextStyle>
            label="Efecto"
            value={th.style}
            options={[
              { value: 'shadow', label: 'Sombra' },
              { value: 'outline', label: 'Contorno' },
              { value: 'band', label: 'Franja' },
            ]}
            onChange={(style) => set({ style })}
          />
          <Check label="Mayúsculas" checked={th.uppercase} onChange={(uppercase) => set({ uppercase })} />
          <Slider label="Tamaño" value={th.size} min={0.6} max={1.4} step={0.01} format={pct} onChange={(size) => set({ size })} />
          {th.style !== 'band' && (
            <Slider label="Oscurecer detrás" value={th.scrim} min={0} max={1} step={0.01} format={pct} onChange={(scrim) => set({ scrim })} />
          )}
          <ColorField label="Color del texto" value={th.color} onChange={(color) => set({ color })} />
          <ColorField label={th.style === 'band' ? 'Color de la franja' : 'Color de la etiqueta'} value={th.accent} onChange={(accent) => set({ accent })} />
        </Section>
      )}

      <div className="export-footer thumb-footer">
        <button type="button" className="primary big" onClick={() => download('image/jpeg')}>
          <Icon name="export" /> Descargar JPG
        </button>
        <button type="button" className="secondary" onClick={() => download('image/png')}>
          Descargar PNG
        </button>
        {msg && <p className="hint ok">{msg}</p>}
      </div>
    </>
  );
}
