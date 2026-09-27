import type { Song } from '../audio/song';
import type { ExportFormat } from '../export/common';
import type { ExportPlan } from '../render/scene';
import type { Timing } from '../render/timing';
import type { SceneConfig } from '../render/types';
import type { SongFit } from '../utils/fit';
import { Icon } from './icons';
import { Check, Section } from './widgets';

export interface ExportSettings {
  plan: ExportPlan;
  format: ExportFormat;
}

export interface ExportStatus {
  running: boolean;
  done: number;
  total: number;
  stage: string;
  message: string;
  error?: boolean;
}

interface Props {
  cfg: SceneConfig;
  timing: Timing;
  settings: ExportSettings;
  setSettings: (s: ExportSettings) => void;
  status: ExportStatus;
  transparent: boolean;
  mp4Available: boolean | null;
  webmNative: boolean | null;
  onExport: () => void;
  onCancel: () => void;
  song: Song | null;
  includeAudio: boolean;
  setIncludeAudio: (v: boolean) => void;
  /** Plan that matches the song duration, if any. */
  fit: SongFit | null;
  onUseFit: () => void;
}

const fmt = (n: number, d = 1) => n.toLocaleString('es-AR', { maximumFractionDigits: d });

export function ExportPanel(p: Props) {
  const { cfg, timing: t, settings, status: st } = p;
  const plan = settings.plan;
  const setPlan = (patch: Partial<ExportPlan>) => p.setSettings({ ...settings, plan: { ...plan, ...patch } });
  const frames = (plan.intro ? t.I : 0) + plan.loops * t.F + (plan.outro ? t.O : 0);
  const mp4Blocked = p.transparent || p.mp4Available === false;
  const fit = p.fit;
  const matchesFit = !!fit && plan.intro && plan.outro && plan.loops === fit.loops && t.I === fit.introFrames && t.O === fit.outroFrames;
  const withAudio = !!p.song && p.includeAudio;

  const formats: { value: ExportFormat; name: string; desc: string; alpha: boolean; disabled?: string }[] = [
    {
      value: 'mp4',
      name: 'MP4',
      desc: 'Para redes y edición. El más liviano.',
      alpha: false,
      disabled: p.transparent ? 'No soporta transparencia' : p.mp4Available === false ? 'Este navegador no puede codificar H.264' : undefined,
    },
    { value: 'webm', name: 'WebM', desc: p.webmNative === false ? 'Web y OBS. Vía ffmpeg.wasm (VP8).' : 'Web y OBS. VP9.', alpha: true },
    { value: 'png', name: 'PNG (ZIP)', desc: withAudio ? 'Secuencia de imágenes + audio.wav.' : 'Secuencia de imágenes. Máxima compatibilidad.', alpha: true },
    { value: 'prores', name: 'ProRes 4444', desc: 'Premiere, DaVinci, Final Cut. Pesado.', alpha: true },
  ];

  return (
    <>
      <Section title="Qué exportar">
        <div className="plan">
          <Check label={cfg.introEnabled ? `Intro · ${fmt(t.I / cfg.fps)} s` : 'Intro (desactivada)'} checked={plan.intro} disabled={!cfg.introEnabled} onChange={(intro) => setPlan({ intro })} />
          <div className="row stepper-row">
            <span>Loops</span>
            <div className="stepper">
              <button type="button" aria-label="Menos loops" disabled={plan.loops <= 0} onClick={() => setPlan({ loops: Math.max(0, plan.loops - 1) })}>
                −
              </button>
              <output>{plan.loops}</output>
              <button type="button" aria-label="Más loops" disabled={plan.loops >= 50} onClick={() => setPlan({ loops: Math.min(50, plan.loops + 1) })}>
                +
              </button>
            </div>
            <small>× {fmt(t.F / cfg.fps)} s</small>
          </div>
          <Check label={cfg.outroEnabled ? `Outro · ${fmt(t.O / cfg.fps)} s` : 'Outro (desactivado)'} checked={plan.outro} disabled={!cfg.outroEnabled} onChange={(outro) => setPlan({ outro })} />
          {(!cfg.introEnabled || !cfg.outroEnabled) && <p className="hint">La intro y el outro se activan en la pestaña Música.</p>}
        </div>
        {fit && !matchesFit && (
          <button type="button" className="secondary" onClick={p.onUseFit}>
            Usar el plan del tema: {fit.loops} loops, dura lo mismo que la canción
          </button>
        )}
        {fit && matchesFit && <p className="hint ok">Dura exactamente lo mismo que el tema.</p>}
        {p.song && (
          <Check label={`Incluir la canción (${p.song.title ?? p.song.name})`} checked={p.includeAudio} onChange={p.setIncludeAudio} />
        )}
      </Section>

      <Section title="Formato">
        <div className="cards" role="radiogroup" aria-label="Formato de archivo">
          {formats.map((f) => {
            const on = settings.format === f.value;
            const disabled = f.value === 'mp4' && mp4Blocked;
            return (
              <button
                key={f.value}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={disabled}
                className={on ? 'card on' : 'card'}
                onClick={() => p.setSettings({ ...settings, format: f.value })}
                title={f.disabled}
              >
                <b>
                  {f.name}
                  {f.alpha && <em className="tag">alpha</em>}
                </b>
                <small>{disabled ? f.disabled : f.desc}</small>
              </button>
            );
          })}
        </div>
        {(settings.format === 'prores' || (settings.format === 'webm' && p.webmNative === false)) && (
          <p className="hint">Usa ffmpeg.wasm: es más lento y la primera vez descarga ~32 MB (después queda en caché).</p>
        )}
      </Section>

      <div className="export-footer">
        <div className="summary">
          <b>{frames} frames</b> · {fmt(frames / cfg.fps, 2)} s · {cfg.width}×{cfg.height} · {cfg.fps} fps{withAudio ? ' · con audio' : ''}
        </div>
        {st.running ? (
          <div className="progress-wrap">
            <div className="progress">
              <progress value={st.done} max={st.total || 1} />
              <button type="button" className="secondary" onClick={p.onCancel}>
                Cancelar
              </button>
            </div>
            <p className="hint">
              {st.stage || 'Preparando'}… {st.total > 0 && `${Math.round((st.done / st.total) * 100)} %`}
            </p>
          </div>
        ) : (
          <button type="button" className="primary big" disabled={frames === 0} onClick={p.onExport}>
            <Icon name="export" /> Exportar {formats.find((f) => f.value === settings.format)?.name}
          </button>
        )}
        {st.message && <p className={st.error ? 'hint warn' : 'hint ok'}>{st.message}</p>}
      </div>
    </>
  );
}
