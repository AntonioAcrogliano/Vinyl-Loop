import { useEffect, useRef, useState } from 'react';
import type { Song } from '../audio/song';
import { downloadBlob } from '../export/common';
import type { LrclibResult } from '../lyrics/lrclib';
import { linesFromText, parseLrc, toLrc, type LyricLine, type Lyrics, type LyricsSource } from '../lyrics/lyrics';
import type { TranscribeProgress, WhisperModel } from '../lyrics/whisper';
import type { LyricsOpen, SceneConfig, TextFont } from '../render/types';
import { formatDuration, parseDuration } from '../utils/fit';
import { Icon } from './icons';
import { Check, ColorField, Section, Segmented, Slider } from './widgets';

interface Props {
  cfg: SceneConfig;
  update: (patch: Partial<SceneConfig>) => void;
  song: Song | null;
  audio: HTMLAudioElement | null;
  lyrics: Lyrics | null;
  setLyrics: (l: Lyrics | null) => void;
  /** Play the song (video "Canción" mode) from this song time. */
  onPlayAt: (seconds: number) => void;
  onGoToMusic: () => void;
}

const SOURCE_NAME: Record<LyricsSource, string> = { lrclib: 'LRCLIB', whisper: 'Whisper', file: 'archivo .lrc', manual: 'manual' };
const LANGS: [string, string][] = [
  ['', 'Detectar idioma'],
  ['spanish', 'Español'],
  ['english', 'Inglés'],
  ['portuguese', 'Portugués'],
  ['italian', 'Italiano'],
  ['french', 'Francés'],
];

/** 65.25 → "1:05.25" */
function stamp(s: number): string {
  if (!Number.isFinite(s)) return '—';
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
}

/** Time field: shows m:ss.cc, commits on blur / Enter. */
function TimeInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(stamp(value));
  useEffect(() => setText(stamp(value)), [value]);
  const commit = () => {
    const v = parseDuration(text);
    if (v !== null) onChange(v);
    else setText(stamp(value));
  };
  return (
    <input
      className="time"
      type="text"
      value={text}
      aria-label="Inicio de la línea"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

export function LyricsPanel({ cfg, update, song, audio, lyrics, setLyrics, onPlayAt, onGoToMusic }: Props) {
  const L = cfg.lyrics;
  const set = (patch: Partial<SceneConfig['lyrics']>) => update({ lyrics: { ...L, ...patch } });
  const lines = lyrics?.lines ?? [];
  const timed = lines.filter((l) => Number.isFinite(l.start)).length;

  // ---- LRCLIB ----
  const [q, setQ] = useState({ title: '', artist: '' });
  useEffect(() => {
    setQ({ title: song?.title ?? cfg.text.title, artist: song?.artist ?? cfg.text.artist });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song]);
  const [results, setResults] = useState<LrclibResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [msg, setMsg] = useState('');

  const search = async () => {
    setSearching(true);
    setMsg('');
    try {
      const { searchLyrics } = await import('../lyrics/lrclib');
      const r = await searchLyrics({ title: q.title, artist: q.artist, duration: song?.duration });
      setResults(r);
      if (!r.length) setMsg('No encontré letras sincronizadas. Probá con otro título, o transcribila con Whisper.');
    } catch (err) {
      setMsg(`No se pudo buscar: ${(err as Error).message}`);
    } finally {
      setSearching(false);
    }
  };

  const applyResult = async (r: LrclibResult) => {
    const { linesOf } = await import('../lyrics/lrclib');
    setLyrics({ lines: linesOf(r), source: 'lrclib' });
    set({ enabled: true });
    setResults(null);
    setMsg(`Letra de “${r.trackName}” (${r.artistName}) cargada.`);
  };

  // ---- Whisper ----
  const [model, setModel] = useState<WhisperModel>('base');
  const [lang, setLang] = useState('spanish');
  const [tx, setTx] = useState<TranscribeProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runWhisper = async () => {
    if (!song) return;
    const ac = new AbortController();
    abortRef.current = ac;
    setMsg('');
    setTx({ stage: 'decoding' });
    const t0 = performance.now();
    try {
      const { transcribe } = await import('../lyrics/whisper');
      const result = await transcribe(song.file, { model, language: lang || null, onProgress: setTx, signal: ac.signal });
      if (!result.length) setMsg('Whisper no encontró voz. ¿El tema es instrumental?');
      else {
        setLyrics({ lines: result, source: 'whisper' });
        set({ enabled: true });
        setMsg(`Transcripción lista en ${Math.round((performance.now() - t0) / 1000)} s. Revisala: Whisper se puede equivocar con la letra.`);
      }
    } catch (err) {
      setMsg((err as Error).name === 'AbortError' ? 'Transcripción cancelada.' : `Error de Whisper: ${(err as Error).message}`);
    } finally {
      setTx(null);
      abortRef.current = null;
    }
  };

  // ---- Paste / files ----
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const importLrc = async (f: File) => {
    const parsed = parseLrc(await f.text());
    if (parsed.length) {
      setLyrics({ lines: parsed, source: 'file' });
      set({ enabled: true });
      setMsg(`${parsed.length} líneas importadas.`);
    } else setMsg('El archivo no tiene líneas con tiempos (formato LRC).');
  };

  // ---- Editing ----
  const edit = (i: number, patch: Partial<LyricLine>) => {
    const next = lines.slice();
    next[i] = { ...next[i], ...patch };
    // A manual time change invalidates the word timings of that line.
    if (patch.start !== undefined) delete next[i].words;
    setLyrics({ lines: next, source: lyrics?.source ?? 'manual' });
  };
  const remove = (i: number) => setLyrics({ lines: lines.filter((_, k) => k !== i), source: lyrics?.source ?? 'manual' });
  const insertAfter = (i: number) => {
    const next = lines.slice();
    const start = Number.isFinite(lines[i]?.start) ? lines[i].start + 2 : NaN;
    next.splice(i + 1, 0, { start, text: '' });
    setLyrics({ lines: next, source: lyrics?.source ?? 'manual' });
  };
  const sortLines = () =>
    setLyrics({ lines: lines.slice().sort((a, b) => (a.start || 0) - (b.start || 0)), source: lyrics?.source ?? 'manual' });

  // Song clock, to highlight the line being sung and to tap-sync.
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!audio) return;
    const id = setInterval(() => setNow(audio.currentTime), 120);
    return () => clearInterval(id);
  }, [audio]);
  const songNow = now - L.offset;
  let current = -1;
  lines.forEach((l, i) => {
    if (Number.isFinite(l.start) && l.start <= songNow && (current < 0 || l.start >= lines[current].start)) current = i;
  });

  // Tap sync: Enter (or the big button) stamps the next line with the current song time.
  const [tapIndex, setTapIndex] = useState<number | null>(null);
  const tapRef = useRef(tapIndex);
  tapRef.current = tapIndex;
  const tap = () => {
    const i = tapRef.current;
    if (i === null || !audio || i >= lines.length) return;
    edit(i, { start: Math.max(0, audio.currentTime - L.offset) });
    setTapIndex(i + 1 < lines.length ? i + 1 : null);
  };
  useEffect(() => {
    if (tapIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || (e.target instanceof Element && e.target.closest('input, textarea, select'))) return;
      e.preventDefault();
      tap();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!song) {
    return (
      <Section title="Letra karaoke">
        <p className="hint">Primero subí la canción: la letra se sincroniza con el audio y aparece en el video completo del tema.</p>
        <button type="button" className="secondary" onClick={onGoToMusic}>
          <Icon name="music" size={16} /> Ir a Música
        </button>
      </Section>
    );
  }

  return (
    <>
      <Section title="Letra karaoke">
        <Check
          label="Mostrar la letra en el video de la canción"
          checked={L.enabled}
          disabled={!timed}
          onChange={(enabled) => set({ enabled })}
        />
        <p className="hint">
          {lyrics
            ? `${lines.length} líneas · ${SOURCE_NAME[lyrics.source]}${timed < lines.length ? ` · ${lines.length - timed} sin sincronizar` : ''}`
            : 'Todavía no hay letra. Buscala, transcribila o pegala abajo.'}{' '}
          Solo aparece en el modo “Canción”: el loop solo no cambia.
        </p>
      </Section>

      <Section title="Conseguir la letra">
        <h3>Buscar online (LRCLIB)</h3>
        <label className="row text-row">
          <span>Tema</span>
          <input type="text" value={q.title} onChange={(e) => setQ({ ...q, title: e.target.value })} />
        </label>
        <label className="row text-row">
          <span>Artista</span>
          <input type="text" value={q.artist} onChange={(e) => setQ({ ...q, artist: e.target.value })} />
        </label>
        <button type="button" className="secondary" disabled={searching || !q.title.trim()} onClick={search}>
          {searching ? 'Buscando…' : 'Buscar letra sincronizada'}
        </button>
        <p className="hint">Se envían solo el título, el artista y la duración a lrclib.net. El audio no sale de tu compu.</p>
        {results && results.length > 0 && (
          <div className="results" role="list">
            {results.slice(0, 8).map((r) => {
              const diff = r.duration - song.duration;
              return (
                <button key={r.id} type="button" className="result" onClick={() => applyResult(r)} role="listitem">
                  <b>
                    {r.trackName} · {r.artistName}
                  </b>
                  <small>
                    {r.albumName || 'Sin álbum'} · {formatDuration(r.duration)}
                    {Math.abs(diff) < 2 ? ' · misma duración' : ` · ${diff > 0 ? '+' : ''}${Math.round(diff)} s`}
                  </small>
                </button>
              );
            })}
          </div>
        )}

        <h3>Transcribir con Whisper</h3>
        <Segmented<WhisperModel>
          full
          value={model}
          options={[
            { value: 'base', label: 'Rápido (~80 MB)' },
            { value: 'small', label: 'Preciso (~250 MB)' },
          ]}
          onChange={setModel}
        />
        <label className="row">
          <span>Idioma</span>
          <select value={lang} onChange={(e) => setLang(e.target.value)}>
            {LANGS.map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {tx ? (
          <div className="progress-wrap">
            <div className="progress">
              <progress value={tx.stage === 'downloading' ? tx.progress : undefined} max={1} />
              <button type="button" className="secondary" onClick={() => abortRef.current?.abort()}>
                Cancelar
              </button>
            </div>
            <p className="hint">
              {tx.stage === 'decoding' && 'Preparando el audio…'}
              {tx.stage === 'downloading' && `Descargando el modelo (solo la primera vez)… ${Math.round((tx.progress ?? 0) * 100)} %`}
              {tx.stage === 'transcribing' && `Transcribiendo${tx.device ? ` con ${tx.device}` : ''}… puede tardar un par de minutos.`}
            </p>
          </div>
        ) : (
          <button type="button" className="secondary" onClick={runWhisper}>
            Transcribir la canción
          </button>
        )}
        <p className="hint">Corre en tu navegador: el audio no se sube a ningún lado. Da tiempos palabra por palabra, pero puede equivocarse con la letra.</p>

        <h3>Archivo o texto</h3>
        <div className="button-row">
          <label className="button secondary">
            Importar .lrc
            <input
              type="file"
              accept=".lrc,text/plain"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) importLrc(f);
              }}
            />
          </label>
          <button type="button" className="secondary" onClick={() => setPasting((p) => !p)}>
            Pegar texto
          </button>
          <button
            type="button"
            className="secondary"
            disabled={!timed}
            onClick={() => downloadBlob(new Blob([toLrc(lines, { title: song.title ?? song.name, artist: song.artist })], { type: 'text/plain' }), `${song.name}.lrc`)}
          >
            Exportar .lrc
          </button>
        </div>
        {pasting && (
          <div className="paste">
            <textarea rows={8} placeholder="Pegá la letra, una línea por renglón" value={pasted} onChange={(e) => setPasted(e.target.value)} />
            <button
              type="button"
              className="secondary"
              disabled={!pasted.trim()}
              onClick={() => {
                setLyrics({ lines: linesFromText(pasted), source: 'manual' });
                setPasting(false);
                setPasted('');
                setTapIndex(0);
                onPlayAt(0);
                setMsg('Dale Enter (o “Marcar”) cada vez que empieza una línea.');
              }}
            >
              Usar y sincronizar tocando
            </button>
          </div>
        )}
        {msg && <p className="hint ok">{msg}</p>}
      </Section>

      {lyrics && (
        <Section title="Editar y sincronizar">
          <Slider
            label="Corrimiento"
            value={L.offset}
            min={-3}
            max={3}
            step={0.05}
            onChange={(offset) => set({ offset })}
            format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(2)} s`}
          />
          <p className="hint">Si toda la letra va adelantada o atrasada, corregilo acá de una sola vez.</p>
          {tapIndex !== null ? (
            <div className="tap">
              <button type="button" className="primary big" onClick={tap}>
                Marcar ({tapIndex + 1}/{lines.length}): {lines[tapIndex]?.text || '—'}
              </button>
              <p className="hint">
                Tocá <kbd>Enter</kbd> justo cuando empieza cada línea. <button type="button" className="link" onClick={() => setTapIndex(null)}>Terminar</button>
              </p>
            </div>
          ) : (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setTapIndex(0);
                onPlayAt(0);
              }}
            >
              Sincronizar tocando (desde el principio)
            </button>
          )}
          <div className="lines">
            {lines.map((l, i) => (
              <div key={i} className={i === current ? 'line on' : tapIndex === i ? 'line next' : 'line'}>
                <button type="button" className="mini" title="Escuchar desde acá" onClick={() => onPlayAt(Math.max(0, (Number.isFinite(l.start) ? l.start : 0) + L.offset - 1))}>
                  <Icon name="play" size={12} />
                </button>
                <TimeInput value={l.start} onChange={(start) => edit(i, { start })} />
                <input className="text" type="text" value={l.text} aria-label={`Línea ${i + 1}`} onChange={(e) => edit(i, { text: e.target.value })} />
                <button type="button" className="mini" title="Poner el momento actual" onClick={() => audio && edit(i, { start: Math.max(0, audio.currentTime - L.offset) })}>
                  ⌖
                </button>
                <button type="button" className="mini" title="Agregar línea abajo" onClick={() => insertAfter(i)}>
                  +
                </button>
                <button type="button" className="mini" title="Borrar línea" onClick={() => remove(i)}>
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="button-row">
            <button type="button" className="secondary" onClick={() => insertAfter(lines.length - 1)}>
              Agregar línea
            </button>
            <button type="button" className="secondary" onClick={sortLines}>
              Ordenar por tiempo
            </button>
            <button type="button" className="link" onClick={() => setLyrics(null)}>
              Borrar la letra
            </button>
          </div>
        </Section>
      )}

      <Section title="Estilo">
        <Segmented<LyricsOpen>
          full
          value={L.open}
          options={[
            { value: 'slide', label: 'El disco se corre' },
            { value: 'gatefold', label: 'Tapa doble (gatefold)' },
          ]}
          onChange={(open) => set({ open })}
        />
        <Segmented<'left' | 'center'>
          label="Alineación"
          value={L.align}
          options={[
            { value: 'left', label: 'Izquierda' },
            { value: 'center', label: 'Centro' },
          ]}
          onChange={(align) => set({ align })}
        />
        <Segmented<TextFont>
          full
          value={L.font}
          options={[
            { value: 'sans', label: 'Sans' },
            { value: 'serif', label: 'Serif' },
            { value: 'condensed', label: 'Condensada' },
            { value: 'mono', label: 'Mono' },
          ]}
          onChange={(font) => set({ font })}
        />
        <Slider label="Tamaño" value={L.size} min={0.6} max={1.8} step={0.05} onChange={(size) => set({ size })} format={(v) => `${Math.round(v * 100)}%`} />
        <ColorField label="Texto" value={L.color} onChange={(color) => set({ color })} />
        <ColorField label="Resaltado" value={L.highlight} onChange={(highlight) => set({ highlight })} />
        <Slider
          label="Volver al centro"
          value={L.gap}
          min={3}
          max={30}
          step={1}
          onChange={(gap) => set({ gap })}
          format={(v) => `si hay > ${v} s sin letra`}
        />
      </Section>
    </>
  );
}
