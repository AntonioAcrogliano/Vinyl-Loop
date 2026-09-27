import type { ExportFormat } from '../export/common';
import type { ExportPlan } from '../render/scene';
import type { Timing } from '../render/timing';
import type { SceneConfig } from '../render/types';
import { Check, Section, Select } from './widgets';

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
}

export function ExportPanel(p: Props) {
  const { cfg, timing: t, settings, status: st } = p;
  const plan = settings.plan;
  const setPlan = (patch: Partial<ExportPlan>) => p.setSettings({ ...settings, plan: { ...plan, ...patch } });
  const frames = (plan.intro ? t.I : 0) + plan.loops * t.F + (plan.outro ? t.O : 0);
  const secs = (frames / cfg.fps).toLocaleString('es-AR', { maximumFractionDigits: 2 });
  const mp4Blocked = p.transparent || p.mp4Available === false;

  return (
    <Section title="Exportar">
      <div className="plan">
        <Check label={`Intro (${t.I} f)`} checked={plan.intro} disabled={!cfg.introEnabled} onChange={(intro) => setPlan({ intro })} />
        <label className="row">
          <span>Loops</span>
          <input
            type="number"
            min={0}
            max={50}
            value={plan.loops}
            onChange={(e) => setPlan({ loops: Math.max(0, Math.min(50, Math.round(Number(e.target.value) || 0))) })}
          />
          <output>× {t.F} f</output>
        </label>
        <Check label={`Outro (${t.O} f)`} checked={plan.outro} disabled={!cfg.outroEnabled} onChange={(outro) => setPlan({ outro })} />
      </div>
      <p className="hint">
        Total: {frames} frames · {secs} s
      </p>
      <Select<ExportFormat>
        label="Formato"
        value={settings.format}
        options={[
          { value: 'mp4', label: 'MP4 (H.264)', disabled: mp4Blocked },
          { value: 'webm', label: 'WebM (VP9)' + (p.transparent ? ' con alpha' : '') },
          { value: 'png', label: 'Secuencia PNG (ZIP)' },
          { value: 'prores', label: 'ProRes 4444 .mov' + (p.transparent ? ' con alpha' : '') },
        ]}
        onChange={(format) => p.setSettings({ ...settings, format })}
      />
      {p.transparent && <p className="hint warn">MP4 no soporta transparencia. Usá WebM, PNG o ProRes.</p>}
      {!p.transparent && p.mp4Available === false && (
        <p className="hint warn">Este navegador no puede codificar H.264 a este tamaño. Probá Chrome o Edge.</p>
      )}
      {settings.format === 'webm' && p.webmNative === false && (
        <p className="hint">Sin VP9 nativo en este navegador: se exporta VP8 (también con alpha) vía ffmpeg.wasm, más lento y descarga ~32 MB la primera vez.</p>
      )}
      {settings.format === 'prores' && (
        <p className="hint">ProRes se codifica con ffmpeg.wasm: más lento, descarga ~32 MB la primera vez. Ideal para Premiere / DaVinci / Final Cut.</p>
      )}
      {st.running ? (
        <div className="progress-wrap">
          <div className="progress">
            <progress value={st.done} max={st.total || 1} />
            <span>
              {st.done}/{st.total}
            </span>
            <button className="secondary" onClick={p.onCancel}>
              Cancelar
            </button>
          </div>
          {st.stage && <p className="hint">{st.stage}…</p>}
        </div>
      ) : (
        <button className="primary" disabled={frames === 0} onClick={p.onExport}>
          Exportar
        </button>
      )}
      {st.message && <p className="hint">{st.message}</p>}
    </Section>
  );
}
