import type { SceneConfig, TextAnim, TextFont, TextPosition } from '../render/types';
import { Check, ColorField, Section, Segmented, Slider, pct } from './widgets';

interface Props {
  cfg: SceneConfig;
  update: (patch: Partial<SceneConfig>) => void;
  /** Title / artist read from the song's tags, if any. */
  songTags: { title?: string; artist?: string } | null;
  /** Plays intro → loop → outro so the animations can be seen. */
  onPreviewAnimation: () => void;
}

const ANIMS: { value: TextAnim; label: string }[] = [
  { value: 'none', label: 'Ninguna' },
  { value: 'fade', label: 'Fundido' },
  { value: 'slide', label: 'Deslizar' },
  { value: 'wipe', label: 'Barrido' },
  { value: 'typewriter', label: 'Máquina de escribir' },
  { value: 'letters', label: 'Letra por letra' },
];

/** Where the card sits, as a tiny frame pictogram. */
function PosIcon({ pos }: { pos: TextPosition }) {
  const top = pos.startsWith('top');
  const left = pos.endsWith('Left');
  const y = top ? 4 : 14;
  const x = left ? 4 : 9;
  return (
    <svg width="28" height="22" viewBox="0 0 28 22" aria-hidden>
      <rect x="1" y="1" width="26" height="20" rx="2" fill="none" stroke="currentColor" opacity="0.5" />
      <rect x={x} y={y} width={left ? 12 : 10} height="2.2" rx="1" fill="currentColor" />
      <rect x={x} y={y + 3.4} width={left ? 8 : 10} height="1.6" rx="0.8" fill="currentColor" opacity="0.7" />
    </svg>
  );
}

export function TextPanel({ cfg, update, songTags, onPreviewAnimation }: Props) {
  const tx = cfg.text;
  const set = (patch: Partial<SceneConfig['text']>) => update({ text: { ...tx, ...patch } });
  const canUseTags = !!songTags && (!!songTags.title || !!songTags.artist);

  return (
    <>
      <Section title="Texto de presentación">
        <Check label="Mostrar tema y artista" checked={tx.enabled} onChange={(enabled) => set({ enabled })} />
        <label className="row text-row">
          <span>Tema</span>
          <input type="text" value={tx.title} maxLength={80} onChange={(e) => set({ title: e.target.value })} />
        </label>
        <label className="row text-row">
          <span>Artista</span>
          <input type="text" value={tx.artist} maxLength={80} onChange={(e) => set({ artist: e.target.value })} />
        </label>
        {canUseTags && (
          <button
            type="button"
            className="secondary"
            onClick={() => set({ enabled: true, title: songTags!.title ?? tx.title, artist: songTags!.artist ?? tx.artist })}
          >
            Usar los datos de la canción
          </button>
        )}
      </Section>

      <Section title="Estilo">
        <Segmented<TextPosition>
          label="Posición"
          value={tx.position}
          options={(['topLeft', 'top', 'bottomLeft', 'bottom'] as const).map((p) => ({
            value: p,
            label: <PosIcon pos={p} />,
            title: { topLeft: 'Arriba a la izquierda', top: 'Arriba al centro', bottomLeft: 'Abajo a la izquierda', bottom: 'Abajo al centro' }[p],
          }))}
          onChange={(position) => set({ position })}
        />
        <Segmented<TextFont>
          full
          value={tx.font}
          options={[
            { value: 'sans', label: <span style={{ fontFamily: 'Helvetica, Arial, sans-serif', fontWeight: 700 }}>Sans</span> },
            { value: 'serif', label: <span style={{ fontFamily: 'Georgia, serif', fontWeight: 700 }}>Serif</span> },
            { value: 'condensed', label: <span style={{ fontFamily: '"Arial Narrow", sans-serif', fontWeight: 700 }}>Condensada</span> },
            { value: 'mono', label: <span style={{ fontFamily: '"Courier New", monospace', fontWeight: 700 }}>Mono</span> },
          ]}
          onChange={(font) => set({ font })}
        />
        <Slider label="Tamaño" value={tx.size} min={0.5} max={2.2} step={0.05} onChange={(size) => set({ size })} format={pct} />
        <ColorField label="Color" value={tx.color} onChange={(color) => set({ color })} />
        <Check label="Mayúsculas" checked={tx.uppercase} onChange={(uppercase) => set({ uppercase })} />
        <Check label="Sombra (mejor lectura)" checked={tx.shadow} onChange={(shadow) => set({ shadow })} />
      </Section>

      <Section title="Animación">
        {cfg.introEnabled ? (
          <label className="row">
            <span>Entrada</span>
            <select value={tx.animIn} onChange={(e) => set({ animIn: e.target.value as TextAnim })}>
              {ANIMS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="hint">Activá la intro (pestaña Música) para animar la entrada del texto.</p>
        )}
        {cfg.outroEnabled ? (
          <label className="row">
            <span>Salida</span>
            <select value={tx.animOut} onChange={(e) => set({ animOut: e.target.value as TextAnim })}>
              {ANIMS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="hint">Activá el outro para animar la salida.</p>
        )}
        <p className="hint">Durante el loop el texto queda fijo, así el loop sigue cerrando perfecto.</p>
        {(cfg.introEnabled || cfg.outroEnabled) && (
          <button type="button" className="secondary" disabled={!tx.enabled} onClick={onPreviewAnimation}>
            Ver la animación
          </button>
        )}
      </Section>
    </>
  );
}
