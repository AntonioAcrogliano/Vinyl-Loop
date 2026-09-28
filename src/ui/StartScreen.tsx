import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './icons';
import { listProjects, type ProjectSummary } from './projects';

export type ProjectKind = 'loop' | 'song';

interface Props {
  /** Start a loop project (with the photo, when one was dropped). */
  onLoop: (photo?: File) => void;
  /** Start a full-song project with this audio file. */
  onSong: (file: File) => void;
  onOpenProject: (id: string) => Promise<void>;
  onAllProjects: () => void;
  onClose: () => void;
  songLoading: boolean;
}

const isAudio = (f: File) => f.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i.test(f.name);
const dateFmt = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short' });

/** Mini loop illustration: a spinning record with a ∞ badge. */
function LoopArt() {
  return (
    <svg viewBox="0 0 120 80" className="start-art" aria-hidden>
      <g className="start-spin">
        <circle cx="80" cy="40" r="27" fill="#141312" />
        <circle cx="80" cy="40" r="22" fill="none" stroke="#2b2825" strokeWidth="1" />
        <circle cx="80" cy="40" r="17" fill="none" stroke="#2b2825" strokeWidth="1" />
        <circle cx="80" cy="40" r="9" fill="#d8452b" />
        <rect x="78" y="32" width="4" height="4" rx="1" fill="#f3eadb" />
        <circle cx="80" cy="40" r="1.6" fill="#141312" />
      </g>
      <rect x="14" y="13" width="54" height="54" rx="3" fill="#f26a43" />
      <circle cx="41" cy="40" r="15" fill="#f3eadb" />
      <circle cx="41" cy="40" r="10" fill="none" stroke="#1d1a17" strokeWidth="1" />
      <circle cx="41" cy="40" r="4" fill="#1d1a17" />
    </svg>
  );
}

/** Full-song illustration: record + waveform + lyric lines. */
function SongArt() {
  const bars = [6, 12, 20, 14, 26, 18, 30, 22, 12, 24, 16, 28, 10, 18, 8];
  return (
    <svg viewBox="0 0 120 80" className="start-art" aria-hidden>
      <g className="start-spin">
        <circle cx="30" cy="34" r="22" fill="#141312" />
        <circle cx="30" cy="34" r="16" fill="none" stroke="#2b2825" strokeWidth="1" />
        <circle cx="30" cy="34" r="8" fill="#d8452b" />
        <rect x="28" y="27" width="4" height="4" rx="1" fill="#f3eadb" />
        <circle cx="30" cy="34" r="1.5" fill="#141312" />
      </g>
      <rect x="60" y="20" width="46" height="4" rx="2" fill="#f26a43" />
      <rect x="60" y="30" width="36" height="4" rx="2" fill="currentColor" opacity="0.5" />
      <rect x="60" y="40" width="42" height="4" rx="2" fill="currentColor" opacity="0.3" />
      {bars.map((h, k) => (
        <rect key={k} x={10 + k * 7} y={72 - h / 2.2} width="4" height={h / 2.2} rx="2" fill="currentColor" opacity={k < 6 ? 0.9 : 0.35} />
      ))}
    </svg>
  );
}

export function StartScreen(p: Props) {
  const [recent, setRecent] = useState<ProjectSummary[]>([]);
  const [over, setOver] = useState<ProjectKind | null>(null);
  const [error, setError] = useState('');
  const songInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listProjects()
      .then((l) => setRecent(l.slice(0, 4)))
      .catch(() => setRecent([]));
  }, []);
  const urls = useMemo(() => new Map(recent.map((s) => [s.id, s.preview ? URL.createObjectURL(s.preview) : ''])), [recent]);
  useEffect(() => () => urls.forEach((u) => u && URL.revokeObjectURL(u)), [urls]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && p.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p]);

  const pickSong = (f: File | undefined) => {
    if (!f) return;
    if (!isAudio(f)) {
      setError(`“${f.name}” no parece un archivo de audio. Probá con MP3, M4A, WAV, OGG o FLAC.`);
      return;
    }
    p.onSong(f);
  };

  const dropProps = (kind: ProjectKind) => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setOver(kind);
    },
    onDragLeave: () => setOver(null),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setOver(null);
      const f = e.dataTransfer.files[0];
      if (!f) return;
      if (isAudio(f)) pickSong(f);
      else p.onLoop(f);
    },
  });

  return (
    <div className="start" role="dialog" aria-modal="true" aria-labelledby="start-title">
      <div className="start-inner">
        <button type="button" className="icon-btn start-close" aria-label="Cerrar" title="Ir directo al editor" onClick={p.onClose}>
          ✕
        </button>
        <div className="start-brand">
          <div className="logo big" aria-hidden>
            <span />
          </div>
          <span>Vinilo Loop</span>
        </div>
        <h1 id="start-title">¿Qué querés armar hoy?</h1>
        <p className="start-sub">Un disco que gira a partir de una foto. Todo corre en tu navegador: nada se sube a ningún lado.</p>

        <div className="start-cards">
          <button type="button" className={over === 'loop' ? 'start-card over' : 'start-card'} onClick={() => p.onLoop()} {...dropProps('loop')}>
            <LoopArt />
            <b>Un loop para editar</b>
            <span>
              Intro + un giro que empalma perfecto. Lo exportás y lo terminás en tu editor (Premiere, CapCut, DaVinci…) repitiéndolo lo que quieras.
            </span>
            <em>
              Empezar con una foto <Icon name="image" size={14} />
            </em>
          </button>
          <button
            type="button"
            className={over === 'song' ? 'start-card over' : 'start-card'}
            onClick={() => songInput.current?.click()}
            disabled={p.songLoading}
            {...dropProps('song')}
          >
            <SongArt />
            <b>El video del tema completo</b>
            <span>
              Subí la canción y se arma todo el video acá: intro, loops y outro con la duración exacta del tema, con letra karaoke si querés.
            </span>
            <em>
              {p.songLoading ? 'Leyendo la canción…' : 'Elegí o soltá la canción'} <Icon name="music" size={14} />
            </em>
          </button>
        </div>
        {error && <p className="hint warn">{error}</p>}
        <input
          ref={songInput}
          type="file"
          accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.flac"
          hidden
          onChange={(e) => {
            pickSong(e.target.files?.[0]);
            e.target.value = '';
          }}
        />

        {recent.length > 0 && (
          <div className="start-recent">
            <div className="start-recent-head">
              <b>Seguir con un proyecto</b>
              <button type="button" className="link" onClick={p.onAllProjects}>
                Ver todos
              </button>
            </div>
            <div className="start-recent-list">
              {recent.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="start-project"
                  onClick={() => p.onOpenProject(s.id).catch((err) => setError((err as Error).message))}
                >
                  {urls.get(s.id) ? <img src={urls.get(s.id)} alt="" /> : <i />}
                  <span>
                    <b>{s.name}</b>
                    <small>
                      {dateFmt.format(s.updated)}
                      {s.hasSong ? ' · con canción' : ''}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
