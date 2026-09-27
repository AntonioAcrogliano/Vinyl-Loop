import { useState } from 'react';
import type { Song } from '../audio/song';
import type { Timing } from '../render/timing';
import type { SceneConfig } from '../render/types';
import { formatDuration, parseDuration, type SongFit } from '../utils/fit';
import { Icon } from './icons';
import { Check, Section, Segmented, Slider } from './widgets';

interface Props {
  cfg: SceneConfig;
  update: (patch: Partial<SceneConfig>) => void;
  timing: Timing;
  song: Song | null;
  songLoading: boolean;
  onSongFile: (f: File) => void;
  onRemoveSong: () => void;
  /** Duration the video is being fitted to (song or typed), if any. */
  target: number | null;
  fit: SongFit | null;
  /** Frames the current intro + loops + outro plan really has. */
  planFrames: number;
  autoFit: boolean;
  setAutoFit: (v: boolean) => void;
  /** Fit to a typed duration (no song). */
  onFitDuration: (seconds: number) => void;
  onRefit: () => void;
}

const RPM33 = 100 / 3;
type RpmChoice = '33' | '45' | '78' | 'custom';

const fmt = (n: number, d = 2) => n.toLocaleString('es-AR', { maximumFractionDigits: d });

function AudioDrop({ onFile, loading }: { onFile: (f: File) => void; loading: boolean }) {
  const [over, setOver] = useState(false);
  return (
    <label
      className={over ? 'drop over' : 'drop'}
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
        accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.flac"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
      <Icon name="music" size={22} />
      <span className="drop-text">{loading ? 'Leyendo la canción…' : 'Subí la canción'}</span>
      <span className="drop-sub">MP3, M4A, WAV, OGG o FLAC · arma el video con su duración</span>
    </label>
  );
}

export function MusicPanel(p: Props) {
  const { cfg, update, timing: t, song, fit } = p;
  const preset: RpmChoice | null = Math.abs(cfg.rpm - RPM33) < 1e-9 ? '33' : cfg.rpm === 45 ? '45' : cfg.rpm === 78 ? '78' : null;
  const [custom, setCustom] = useState(preset === null);
  const choice: RpmChoice = custom ? 'custom' : (preset ?? 'custom');
  const rpmDelta = ((t.rpmEff - cfg.rpm) / cfg.rpm) * 100;
  const [typed, setTyped] = useState('');
  const typedSecs = parseDuration(typed);
  const planSecs = p.planFrames / cfg.fps;
  const off = p.target !== null && Math.abs(planSecs - p.target) > 0.5 / cfg.fps + 1e-6;

  return (
    <>
      <Section title="Canción">
        {song ? (
          <div className="song">
            <Icon name="music" size={20} />
            <div>
              <b>{song.title ?? song.name}</b>
              <small>
                {song.artist ? `${song.artist} · ` : ''}
                {formatDuration(song.duration)}
              </small>
            </div>
            <button type="button" className="link" onClick={p.onRemoveSong}>
              Quitar
            </button>
          </div>
        ) : (
          <AudioDrop onFile={p.onSongFile} loading={p.songLoading} />
        )}
        {song && (
          <Check label="Armar intro, loops y outro con la duración de la canción" checked={p.autoFit} onChange={p.setAutoFit} />
        )}
        {!song && (
          <>
            <div className="row pair2">
              <input
                type="text"
                inputMode="decimal"
                placeholder="O escribí la duración del tema, ej. 3:42"
                value={typed}
                aria-label="Duración del tema"
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && typedSecs) p.onFitDuration(typedSecs);
                }}
              />
              <button type="button" className="secondary" disabled={!typedSecs} onClick={() => typedSecs && p.onFitDuration(typedSecs)}>
                Armar
              </button>
            </div>
            {typed && !typedSecs && <p className="hint warn">Usá minutos:segundos, por ejemplo 3:42.</p>}
          </>
        )}
        {p.target !== null && fit && (
          <div className="breakdown">
            <div className="bar">
              <i className="intro" style={{ flexGrow: fit.introFrames }} />
              {Array.from({ length: Math.min(fit.loops, 60) }, (_, k) => (
                <i key={k} className="loop" style={{ flexGrow: fit.loopFrames * (fit.loops > 60 ? fit.loops / 60 : 1) }} />
              ))}
              <i className="outro" style={{ flexGrow: fit.outroFrames }} />
            </div>
            <p>
              Intro {fmt(fit.introSeconds, 1)} s + {fit.loops} loops × {fmt(fit.loopFrames / cfg.fps)} s + outro {fmt(fit.outroSeconds, 1)} s ={' '}
              <b>{formatDuration(fit.totalFrames / cfg.fps)}</b>
            </p>
            {off && (
              <p className="hint warn">
                Cambiaste algo y ya no dura {formatDuration(p.target)} ({formatDuration(planSecs)}).{' '}
                <button type="button" className="link" onClick={p.onRefit}>
                  Reajustar
                </button>
              </p>
            )}
          </div>
        )}
        {p.target !== null && !fit && <p className="hint warn">El tema es demasiado corto para una intro, un loop y un outro.</p>}
      </Section>

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
            max={12}
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
            max={12}
            step={0.1}
            onChange={(outroSeconds) => update({ outroSeconds })}
            format={(v) => `${fmt(v, 1)} s`}
          />
        )}
        {p.target !== null && p.autoFit && song && <p className="hint">Con la canción cargada, la intro y el outro se calculan solos para que el video dure lo mismo.</p>}
      </Section>
    </>
  );
}
