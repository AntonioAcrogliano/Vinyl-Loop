import { useEffect, useRef, useState } from 'react';
import type { Song } from '../audio/song';
import { downloadBlob } from '../export/common';
import type { LrclibResult } from '../lyrics/lrclib';
import { linesFromText, parseLrc, toLrc, type LyricLine, type Lyrics, type LyricsSource } from '../lyrics/lyrics';
import type { TranscribeOptions, TranscribeProgress, WhisperModel } from '../lyrics/whisper';
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
  /** Isolated vocals became available (for the timing editor's waveform). */
  onVocals: (v: Float32Array | null) => void;
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

export function LyricsPanel({ cfg, update, song, audio, lyrics, setLyrics, onPlayAt, onGoToMusic, onVocals }: Props) {
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

  // ---- Whisper (transcription and automatic sync share the same settings and progress) ----
  const [model, setModel] = useState<WhisperModel>('small');
  const [lang, setLang] = useState('spanish');
  const [isolate, setIsolate] = useState(true);
  const [gpu, setGpu] = useState<boolean | null>(null);
  useEffect(() => {
    import('../lyrics/whisper').then((w) => w.hasWebGpu()).then(setGpu);
  }, []);
  const [tx, setTx] = useState<TranscribeProgress | null>(null);
  const [txLabel, setTxLabel] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const withWhisper = async (label: string, job: (opts: TranscribeOptions) => Promise<void>) => {
    if (!song || tx) return;
    const ac = new AbortController();
    abortRef.current = ac;
    setMsg('');
    setTxLabel(label);
    setTx({ stage: 'decoding' });
    try {
      await job({ model, language: lang || null, isolate, onProgress: setTx, signal: ac.signal });
      if (isolate) onVocals((await import('../lyrics/whisper')).cachedVocals(song.file));
    } catch (err) {
      setMsg((err as Error).name === 'AbortError' ? 'Cancelado.' : `Error de Whisper: ${(err as Error).message}`);
    } finally {
      setTx(null);
      abortRef.current = null;
    }
  };

  const runWhisper = () =>
    withWhisper('Transcribiendo', async (opts) => {
      const t0 = performance.now();
      const { transcribe } = await import('../lyrics/whisper');
      const result = await transcribe(song!.file, opts);
      if (!result.length) setMsg('Whisper no encontró voz. ¿El tema es instrumental?');
      else {
        setLyrics({ lines: result, source: 'whisper' });
        set({ enabled: true });
        setMsg(`Transcripción lista en ${Math.round((performance.now() - t0) / 1000)} s. Revisala: Whisper se puede equivocar con la letra.`);
      }
    });

  /** Keeps the given text exactly and takes the timings from the audio (word by word). */
  const autoSync = (target: { text: string }[], source: LyricsSource) =>
    withWhisper('Sincronizando la letra con el audio', async (opts) => {
      const { syncLyrics } = await import('../lyrics/whisper');
      const r = await syncLyrics(song!.file, target, opts);
      if (r.matched === 0) {
        setMsg('No pude reconocer esta letra en el audio. ¿Es la misma canción y el idioma correcto? Podés sincronizarla tocando.');
        return;
      }
      setLyrics({ lines: r.lines, source });
      set({ enabled: true });
      const pct = Math.round(r.matched * 100);
      setMsg(
        pct === 100
          ? 'Sincronizada palabra por palabra: se reconocieron todas las palabras.'
          : `Sincronizada palabra por palabra: se reconoció el ${pct} % de las palabras` +
              (r.matched < 0.5 ? '. Bastante quedó estimado: revisá los tiempos o corregilos tocando.' : '; el resto se ubicó entre sus vecinas.'),
      );
    });

  const applyResult = async (r: LrclibResult) => {
    const { linesOf } = await import('../lyrics/lrclib');
    const found = linesOf(r);
    setResults(null);
    if (r.syncedLyrics) {
      setLyrics({ lines: found, source: 'lrclib' });
      set({ enabled: true });
      setMsg(`Letra de “${r.trackName}” (${r.artistName}) cargada.`);
    } else {
      // Plain lyrics: correct text, no timings → align them to the audio.
      setLyrics({ lines: found, source: 'lrclib' });
      await autoSync(found, 'lrclib');
    }
  };

  // ---- Paste / files ----
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
        {tx && (
          <div className="progress-wrap task">
            <div className="progress">
              <progress value={tx.progress} max={1} />
              <button type="button" className="secondary" onClick={() => abortRef.current?.abort()}>
                Cancelar
              </button>
            </div>
            <p className="hint">
              {tx.stage === 'decoding' && 'Preparando el audio…'}
              {tx.stage === 'separator' && `Descargando el separador de voz (67 MB, solo la primera vez)… ${Math.round((tx.progress ?? 0) * 100)} %`}
              {tx.stage === 'separating' && `Separando la voz de la música${tx.device ? ` (${tx.device})` : ''}… ${Math.round((tx.progress ?? 0) * 100)} %`}
              {tx.stage === 'downloading' && `Descargando el modelo de Whisper (solo la primera vez)… ${Math.round((tx.progress ?? 0) * 100)} %`}
              {tx.stage === 'transcribing' && `${txLabel}${tx.device ? ` (${tx.device})` : ''}… puede tardar un par de minutos.`}
            </p>
          </div>
        )}
        {msg && <p className="hint ok">{msg}</p>}

        <h3>1 · Buscarla online (LRCLIB)</h3>
        <label className="row text-row">
          <span>Tema</span>
          <input type="text" value={q.title} onChange={(e) => setQ({ ...q, title: e.target.value })} />
        </label>
        <label className="row text-row">
          <span>Artista</span>
          <input type="text" value={q.artist} onChange={(e) => setQ({ ...q, artist: e.target.value })} />
        </label>
        <button type="button" className="secondary" disabled={searching || !q.title.trim()} onClick={search}>
          {searching ? 'Buscando…' : 'Buscar letra'}
        </button>
        <p className="hint">Se envían solo el título, el artista y la duración a lrclib.net. El audio no sale de tu compu.</p>
        {results && results.length > 0 && (
          <div className="results" role="list">
            {results.slice(0, 8).map((r) => {
              const diff = r.duration - song.duration;
              return (
                <button key={r.id} type="button" className="result" disabled={!!tx} onClick={() => applyResult(r)} role="listitem">
                  <b>
                    {r.trackName} · {r.artistName} {r.syncedLyrics ? <em className="tag">sincronizada</em> : <em className="tag plain">solo texto</em>}
                  </b>
                  <small>
                    {r.albumName || 'Sin álbum'} · {formatDuration(r.duration)}
                    {Math.abs(diff) < 2 ? ' · misma duración' : ` · ${diff > 0 ? '+' : ''}${Math.round(diff)} s`}
                    {!r.syncedLyrics && ' · se sincroniza con el audio'}
                  </small>
                </button>
              );
            })}
          </div>
        )}

        <h3>2 · Pegar la letra</h3>
        <div className="paste">
          <textarea rows={6} placeholder="Pegá la letra acá, una línea por renglón" value={pasted} onChange={(e) => setPasted(e.target.value)} />
          <button
            type="button"
            className="primary"
            disabled={!pasted.trim() || !!tx}
            onClick={async () => {
              const pastedLines = linesFromText(pasted);
              setLyrics({ lines: pastedLines, source: 'manual' });
              setPasted('');
              await autoSync(pastedLines, 'manual');
            }}
          >
            Sincronizar automáticamente
          </button>
          <button
            type="button"
            className="secondary"
            disabled={!pasted.trim()}
            onClick={() => {
              setLyrics({ lines: linesFromText(pasted), source: 'manual' });
              setPasted('');
              setTapIndex(0);
              onPlayAt(0);
              setMsg('Dale Enter (o “Marcar”) cada vez que empieza una línea.');
            }}
          >
            Sincronizar tocando
          </button>
        </div>
        <p className="hint">
          Automático: Whisper escucha la canción y se ubica cada palabra de tu letra en el audio. Tu texto no se cambia; solo se le ponen los tiempos.
        </p>

        <h3>3 · Transcribirla (si no tenés la letra)</h3>
        <button type="button" className="secondary" disabled={!!tx} onClick={runWhisper}>
          Transcribir la canción con Whisper
        </button>

        <h3>Ajustes de Whisper</h3>
        <Segmented<WhisperModel>
          full
          value={model}
          options={[
            { value: 'base', label: 'Rápido', title: '~80 MB' },
            { value: 'small', label: 'Preciso', title: '~250 MB' },
            { value: 'large', label: 'Máxima', title: gpu === false ? 'Necesita WebGPU' : '~560 MB, necesita WebGPU', disabled: gpu === false },
          ]}
          onChange={setModel}
        />
        <p className="hint">
          {model === 'base' && 'Rápido (~80 MB): bien para voz clara; con música erra bastante.'}
          {model === 'small' && 'Preciso (~250 MB): buen equilibrio para temas cantados.'}
          {model === 'large' && 'Máxima precisión (~560 MB, WebGPU): el mejor con voz cantada. La primera descarga tarda.'}
        </p>
        <Check label="Aislar la voz antes de escuchar (recomendado)" checked={isolate} onChange={setIsolate} />
        <p className="hint">Separa la voz de los instrumentos con un modelo de IA (67 MB, una vez). Es lo que más mejora la sincronización en temas con mucha música; suma uno o dos minutos.</p>
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
        <p className="hint">Se usan para sincronizar y para transcribir. Corre en tu navegador: el audio no se sube; el modelo se descarga una vez.</p>

        <h3>Archivo .lrc</h3>
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
          <button
            type="button"
            className="secondary"
            disabled={!timed}
            onClick={() => downloadBlob(new Blob([toLrc(lines, { title: song.title ?? song.name, artist: song.artist })], { type: 'text/plain' }), `${song.name}.lrc`)}
          >
            Exportar .lrc
          </button>
        </div>
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
            <div className="button-row">
              <button type="button" className="secondary" disabled={!!tx || !lines.length} onClick={() => autoSync(lines, lyrics.source)}>
                Ajustar tiempos automáticamente
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setTapIndex(0);
                  onPlayAt(0);
                }}
              >
                Sincronizar tocando
              </button>
            </div>
          )}
          {tx && <p className="hint">{txLabel}… (arriba podés ver el progreso o cancelar)</p>}
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
