import { useState } from 'react';
import type { Timing } from '../render/timing';
import type { SceneConfig } from '../render/types';
import { Check, Section, Segmented, Slider } from './widgets';

interface Props {
  cfg: SceneConfig;
  update: (patch: Partial<SceneConfig>) => void;
  timing: Timing;
}

const RPM33 = 100 / 3;
type RpmChoice = '33' | '45' | '78' | 'custom';

const fmt = (n: number, d = 2) => n.toLocaleString('es-AR', { maximumFractionDigits: d });

export function MotionPanel({ cfg, update, timing: t }: Props) {
  const preset: RpmChoice | null = Math.abs(cfg.rpm - RPM33) < 1e-9 ? '33' : cfg.rpm === 45 ? '45' : cfg.rpm === 78 ? '78' : null;
  const [custom, setCustom] = useState(preset === null);
  const choice: RpmChoice = custom ? 'custom' : (preset ?? 'custom');
  const rpmDelta = ((t.rpmEff - cfg.rpm) / cfg.rpm) * 100;

  return (
    <>
      <Section title="Velocidad">
        <Segmented<RpmChoice>
          full
          value={choice}
          options={[
            { value: '33', label: '33⅓' },
            { value: '45', label: '45' },
            { value: '78', label: '78' },
            { value: 'custom', label: 'Custom' },
          ]}
          onChange={(v) => {
            setCustom(v === 'custom');
            if (v !== 'custom') update({ rpm: v === '33' ? RPM33 : Number(v) });
          }}
        />
        {choice === 'custom' && (
          <label className="row">
            <span>RPM</span>
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
        <Segmented<number>
          label="FPS"
          value={cfg.fps}
          options={[24, 25, 30, 60].map((f) => ({ value: f, label: String(f) }))}
          onChange={(fps) => update({ fps })}
        />
        <Slider
          label="Duración del loop"
          value={cfg.targetLoopSeconds}
          min={1}
          max={30}
          step={0.5}
          onChange={(targetLoopSeconds) => update({ targetLoopSeconds })}
          format={(v) => `~${fmt(v)} s`}
        />
        <div className="stats" aria-live="polite">
          <div>
            <b>{t.F}</b>
            <span>frames</span>
          </div>
          <div>
            <b>{fmt(t.F / t.fps)} s</b>
            <span>loop</span>
          </div>
          <div>
            <b>{t.N}</b>
            <span>{t.N === 1 ? 'vuelta' : 'vueltas'}</span>
          </div>
          <div>
            <b>{fmt(t.rpmEff)}</b>
            <span>rpm reales</span>
          </div>
        </div>
        <p className="hint">
          El loop cierra exacto: se ajustan la duración y las rpm
          {Math.abs(rpmDelta) >= 0.01 ? ` (${rpmDelta > 0 ? '+' : ''}${fmt(rpmDelta)} %, imperceptible)` : ''} para que el
          último frame empalme con el primero.
        </p>
      </Section>

      <Section title="Intro y outro">
        <Check label="Intro: el disco sale del sobre" checked={cfg.introEnabled} onChange={(introEnabled) => update({ introEnabled })} />
        {cfg.introEnabled && (
          <Slider
            label="Duración intro"
            value={cfg.introSeconds}
            min={0.5}
            max={8}
            step={0.1}
            onChange={(introSeconds) => update({ introSeconds })}
            format={(v) => `${fmt(v, 1)} s`}
          />
        )}
        <Check label="Outro: el disco vuelve a entrar" checked={cfg.outroEnabled} onChange={(outroEnabled) => update({ outroEnabled })} />
        {cfg.outroEnabled && (
          <Slider
            label="Duración outro"
            value={cfg.outroSeconds}
            min={0.5}
            max={8}
            step={0.1}
            onChange={(outroSeconds) => update({ outroSeconds })}
            format={(v) => `${fmt(v, 1)} s`}
          />
        )}
      </Section>
    </>
  );
}
