import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Song } from '../audio/song';
import { ExportCancelled, canvasFactory, downloadBlob, type ExportJob, type ExportResult } from '../export/common';
import { getBackground } from '../render/backgrounds';
import { cleanLines, type Lyrics } from '../lyrics/lyrics';
import { framesFor, timingFor, type SongContext } from '../render/scene';
import { DEFAULT_CONFIG, DEFAULT_CROP, type SceneConfig } from '../render/types';
import { fitToDuration, formatDuration, type SongFit } from '../utils/fit';
import { extractPalette } from '../utils/palette';
import { BackgroundPanel } from './BackgroundPanel';
import { ExportPanel, type ExportSettings, type ExportStatus } from './ExportPanel';
import { Icon, type IconName } from './icons';
import { ImagePanel, type LoadedImage } from './ImagePanel';
import { LyricsPanel } from './LyricsPanel';
import { MusicPanel } from './MusicPanel';
import { PresetPanel } from './PresetPanel';
import { Preview, type PreviewMode } from './Preview';
import { ScenePanel } from './ScenePanel';
import { TextPanel } from './TextPanel';

async function loadImage(file: Blob, name: string): Promise<LoadedImage> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Formato no soportado');
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  return { bitmap, name: name.replace(/\.[^.]+$/, '') };
}

const IDLE: ExportStatus = { running: false, done: 0, total: 0, stage: '', message: '' };

async function runExport(job: ExportJob): Promise<ExportResult> {
  // Each exporter is loaded on demand; ffmpeg.wasm in particular is only fetched when used.
  switch (job.format) {
    case 'mp4':
      return (await import('../export/mp4')).exportMp4(job);
    case 'webm':
      return (await import('../export/webm')).exportWebm(job);
    case 'png':
      return (await import('../export/pngZip')).exportPngZip(job);
    case 'prores':
      return (await import('../export/prores')).exportProRes(job);
  }
}

type Tab = 'image' | 'scene' | 'text' | 'music' | 'lyrics' | 'background' | 'export';
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'image', label: 'Imagen', icon: 'image' },
  { id: 'scene', label: 'Escena', icon: 'scene' },
  { id: 'text', label: 'Texto', icon: 'text' },
  { id: 'music', label: 'Música', icon: 'music' },
  { id: 'lyrics', label: 'Letra', icon: 'mic' },
  { id: 'background', label: 'Fondo', icon: 'background' },
  { id: 'export', label: 'Exportar', icon: 'export' },
];

const isAudio = (f: File) => f.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i.test(f.name);

export function App() {
  const [cfg, setCfg] = useState<SceneConfig>(DEFAULT_CONFIG);
  const [cover, setCover] = useState<LoadedImage | null>(null);
  const [label, setLabel] = useState<LoadedImage | null>(null);
  const [song, setSong] = useState<Song | null>(null);
  const [songLoading, setSongLoading] = useState(false);
  const [autoFit, setAutoFit] = useState(true);
  const [typedDuration, setTypedDuration] = useState<number | null>(null);
  const [includeAudio, setIncludeAudio] = useState(true);
  const [lyrics, setLyrics] = useState<Lyrics | null>(null);
  const [seekRequest, setSeekRequest] = useState<{ time: number; id: number } | null>(null);
  // One audio element per song, shared by the preview (song mode) and the lyrics editor.
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  const [tab, setTab] = useState<Tab>('image');
  const [mode, setMode] = useState<PreviewMode>('introLoop');
  const [playing, setPlaying] = useState(true);
  const [restartKey, setRestartKey] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [toast, setToast] = useState('');
  const [exportSettings, setExportSettings] = useState<ExportSettings>({
    plan: { intro: true, loops: 1, outro: false },
    format: 'mp4',
  });
  const [exportStatus, setExportStatus] = useState<ExportStatus>(IDLE);
  const [mp4Available, setMp4Available] = useState<boolean | null>(null);
  const [webmNative, setWebmNative] = useState<boolean | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const update = useCallback((patch: Partial<SceneConfig>) => setCfg((c) => ({ ...c, ...patch })), []);
  const timing = timingFor(cfg);
  const images = useMemo(() => ({ cover: cover?.bitmap ?? null, label: label?.bitmap ?? null }), [cover, label]);
  const transparent = !!getBackground(cfg.background.id).transparent;

  const photoPalette = useMemo(() => (cover ? extractPalette(cover.bitmap, canvasFactory, 5) : null), [cover]);
  // "Colores desde la foto": keep the palette synced when the photo changes.
  useEffect(() => {
    if (!cfg.background.paletteFromPhoto || !photoPalette) return;
    if (cfg.background.palette.join() === photoPalette.join()) return;
    setCfg((c) => ({ ...c, background: { ...c.background, palette: photoPalette } }));
  }, [photoPalette, cfg.background.paletteFromPhoto, cfg.background.palette]);

  useEffect(() => {
    let alive = true;
    Promise.all([import('../export/mp4'), import('../export/webm')]).then(async ([mp4, webm]) => {
      const [a, b] = await Promise.all([
        mp4.mp4Supported(cfg.width, cfg.height, cfg.fps),
        webm.webmNativeSupported(cfg.width, cfg.height, cfg.fps),
      ]);
      if (alive) {
        setMp4Available(a);
        setWebmNative(b);
      }
    });
    return () => {
      alive = false;
    };
  }, [cfg.width, cfg.height, cfg.fps]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  // ---------- Song / duration fitting ----------
  const target = song ? song.duration : typedDuration;
  const fit = useMemo<SongFit | null>(
    () => (target ? fitToDuration(target, cfg) : null),
    // The loop length only depends on these; intro/outro are outputs of the fit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [target, cfg.fps, cfg.rpm, cfg.targetLoopSeconds],
  );

  const applyFit = useCallback((f: SongFit) => {
    setCfg((c) => ({ ...c, introEnabled: true, outroEnabled: true, introSeconds: f.introSeconds, outroSeconds: f.outroSeconds }));
    setExportSettings((s) => ({ ...s, plan: { intro: true, loops: f.loops, outro: true } }));
  }, []);

  // With a song and auto-fit on, keep the video exactly as long as the song.
  useEffect(() => {
    if (!song || !autoFit || !fit) return;
    const same =
      cfg.introEnabled &&
      cfg.outroEnabled &&
      Math.round(cfg.introSeconds * cfg.fps) === fit.introFrames &&
      Math.round(cfg.outroSeconds * cfg.fps) === fit.outroFrames &&
      exportSettings.plan.loops === fit.loops &&
      exportSettings.plan.intro &&
      exportSettings.plan.outro;
    if (!same) applyFit(fit);
  }, [song, autoFit, fit, applyFit, cfg.introEnabled, cfg.outroEnabled, cfg.introSeconds, cfg.outroSeconds, cfg.fps, exportSettings.plan]);

  const onFitDuration = (secs: number) => {
    setTypedDuration(secs);
    const f = fitToDuration(secs, cfg);
    if (!f) {
      setToast('El tema es demasiado corto para una intro, un loop y un outro.');
      return;
    }
    applyFit(f);
    setToast(`Listo: ${f.loops} loops para ${formatDuration(secs)}.`);
  };

  // Keep the export settings valid for the current scene.
  const mp4Blocked = transparent || mp4Available === false;
  const effective: ExportSettings = {
    format: exportSettings.format === 'mp4' && mp4Blocked ? 'webm' : exportSettings.format,
    plan: {
      intro: cfg.introEnabled && exportSettings.plan.intro,
      loops: exportSettings.plan.loops,
      outro: cfg.outroEnabled && exportSettings.plan.outro,
    },
  };
  const planFrames = framesFor(timing, effective.plan).length;
  const songPlan = useMemo(
    () => (target !== null ? effective.plan : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [target, effective.plan.intro, effective.plan.loops, effective.plan.outro],
  );

  useEffect(() => {
    if (!song) {
      setAudio(null);
      return;
    }
    const a = new Audio(song.url);
    a.preload = 'auto';
    setAudio(a);
    return () => a.pause();
  }, [song]);

  // Karaoke context: the lyrics with the plan the song video uses.
  const songCtx = useMemo<SongContext | null>(() => {
    if (!songPlan || !lyrics || !cfg.lyrics.enabled) return null;
    const lines = cleanLines(lyrics.lines);
    return lines.length ? { lines, plan: songPlan } : null;
  }, [songPlan, lyrics, cfg.lyrics.enabled]);

  const playAt = (time: number) => {
    setMode('song');
    setSeekRequest((r) => ({ time, id: (r?.id ?? 0) + 1 }));
    setPlaying(true);
  };

  // ---------- Files ----------
  const onImage = useCallback(async (kind: 'cover' | 'label', file: File) => {
    try {
      const img = await loadImage(file, file.name);
      if (kind === 'cover') {
        setCover(img);
        setCfg((c) => ({
          ...c,
          coverCrop: DEFAULT_CROP,
          // A label cut from the cover gets a fresh crop for the new photo.
          labelCrop: c.label.source === 'image' ? c.labelCrop : DEFAULT_CROP,
        }));
        setToast(`Foto cargada: ${img.name}`);
      } else {
        setLabel(img);
        setCfg((c) => ({ ...c, labelCrop: DEFAULT_CROP }));
      }
    } catch {
      setToast(`No pude abrir “${file.name}”. Usá JPG, PNG o WebP.`);
    }
  }, []);

  const coverRef = useRef(cover);
  coverRef.current = cover;
  const onSongFile = useCallback(async (file: File) => {
    setSongLoading(true);
    try {
      // Loaded on demand: the audio reader (Mediabunny) isn't needed until a song is added.
      const { loadSong } = await import('../audio/song');
      const s = await loadSong(file);
      setSong((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return s;
      });
      setAutoFit(true);
      const notes: string[] = [];
      // Title card from the tags, unless the user already typed something.
      if (s.title || s.artist) {
        setCfg((c) => {
          const untouched = c.text.title === DEFAULT_CONFIG.text.title && c.text.artist === DEFAULT_CONFIG.text.artist;
          if (!untouched) return c;
          return { ...c, text: { ...c.text, title: s.title ?? c.text.title, artist: s.artist ?? c.text.artist } };
        });
        notes.push('texto completado con los datos del tema');
      }
      // Embedded cover art becomes the photo if there is none yet.
      if (s.cover && !coverRef.current) {
        try {
          const img = await loadImage(s.cover, s.name);
          setCover(img);
          setCfg((c) => ({ ...c, coverCrop: DEFAULT_CROP, labelCrop: DEFAULT_CROP }));
          notes.push('se usó la tapa del archivo');
        } catch {
          // Unsupported cover image format: ignore.
        }
      }
      setMode('song');
      setPlaying(false);
      setRestartKey((k) => k + 1);
      setToast(`Canción cargada (${formatDuration(s.duration)})${notes.length ? ': ' + notes.join(', ') : ''}. Dale play para escucharla.`);
    } catch (err) {
      setToast(`No pude leer “${file.name}”: ${(err as Error).message}`);
    } finally {
      setSongLoading(false);
    }
  }, []);

  const removeSong = () => {
    if (song) URL.revokeObjectURL(song.url);
    setSong(null);
    setLyrics(null);
    if (mode === 'song' && typedDuration === null) setMode('introLoop');
  };

  // Drop an image (cover) or a song anywhere in the window.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const f = e.dataTransfer?.files[0];
      if (!f) return;
      if (isAudio(f)) onSongFile(f);
      else onImage('cover', f);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [onImage, onSongFile]);

  // ---------- Export ----------
  const onExport = async () => {
    const ac = new AbortController();
    abortRef.current = ac;
    const job: ExportJob = {
      cfg,
      images,
      plan: effective.plan,
      format: effective.format,
      name: song?.name ?? cover?.name ?? 'vinilo',
      audio: song && includeAudio ? song.file : undefined,
      song: songCtx ? { lines: songCtx.lines, plan: effective.plan } : null,
      signal: ac.signal,
      onProgress: (done, total, stage = '') => setExportStatus({ running: true, done, total, stage, message: '' }),
    };
    setExportStatus({ ...IDLE, running: true, stage: 'Preparando' });
    const t0 = performance.now();
    try {
      const res = await runExport(job);
      downloadBlob(res.blob, res.filename);
      const secs = ((performance.now() - t0) / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 });
      const mb = (res.blob.size / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 });
      setExportStatus({ ...IDLE, message: `Listo: ${res.filename} (${mb} MB, ${secs} s)` });
    } catch (err) {
      const cancelled = err instanceof ExportCancelled || ac.signal.aborted;
      setExportStatus({ ...IDLE, error: !cancelled, message: cancelled ? 'Exportación cancelada.' : `Error: ${(err as Error).message}` });
    } finally {
      abortRef.current = null;
    }
  };

  const restart = (m: PreviewMode) => {
    setMode(m);
    setRestartKey((k) => k + 1);
    setPlaying(true);
  };

  const exportProgress = exportStatus.running && exportStatus.total > 0 ? Math.round((exportStatus.done / exportStatus.total) * 100) : null;
  const modes: [PreviewMode, string, string, boolean][] = [
    ['loop', 'Loop', 'Solo el loop, repetido: para chequear el empalme', true],
    ['introLoop', 'Intro + loop', 'La intro una vez y después el loop', cfg.introEnabled],
    ['full', 'Completo', 'Intro, dos loops y outro', cfg.introEnabled || cfg.outroEnabled],
  ];
  if (target !== null) modes.push(['song', song ? 'Canción' : 'Tema', 'El video entero, como se va a exportar' + (song ? ', con la música' : ''), true]);

  return (
    <div className="app">
      <aside className="sidebar">
        <header className="brand">
          <div className="logo" aria-hidden>
            <span />
          </div>
          <div>
            <h1>Vinilo Loop</h1>
            <p>Todo corre en tu navegador</p>
          </div>
        </header>
        <nav className="tabs" role="tablist" aria-label="Secciones">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? 'tab on' : 'tab'}
              onClick={() => setTab(t.id)}
            >
              <Icon name={t.icon} />
              <span>{t.label}</span>
              {t.id === 'export' && exportProgress !== null && <em className="badge">{exportProgress}%</em>}
              {t.id === 'music' && song && <em className="dot" aria-label="canción cargada" />}
              {t.id === 'lyrics' && songCtx && <em className="dot" aria-label="letra activa" />}
            </button>
          ))}
        </nav>
        <div className="panel" role="tabpanel">
          {tab === 'image' && <ImagePanel cfg={cfg} update={update} cover={cover} label={label} onImage={onImage} />}
          {tab === 'scene' && <ScenePanel cfg={cfg} update={update} />}
          {tab === 'text' && (
            <TextPanel
              cfg={cfg}
              update={update}
              songTags={song ? { title: song.title, artist: song.artist } : null}
              onPreviewAnimation={() => restart('full')}
            />
          )}
          {tab === 'music' && (
            <MusicPanel
              cfg={cfg}
              update={update}
              timing={timing}
              song={song}
              songLoading={songLoading}
              onSongFile={onSongFile}
              onRemoveSong={removeSong}
              target={target}
              fit={fit}
              planFrames={planFrames}
              autoFit={autoFit}
              setAutoFit={setAutoFit}
              onFitDuration={onFitDuration}
              onRefit={() => fit && applyFit(fit)}
            />
          )}
          {tab === 'lyrics' && (
            <LyricsPanel
              cfg={cfg}
              update={update}
              song={song}
              audio={audio}
              lyrics={lyrics}
              setLyrics={setLyrics}
              onPlayAt={playAt}
              onGoToMusic={() => setTab('music')}
            />
          )}
          {tab === 'background' && <BackgroundPanel cfg={cfg} update={update} photoPalette={photoPalette} />}
          {tab === 'export' && (
            <>
              <ExportPanel
                cfg={cfg}
                timing={timing}
                settings={effective}
                setSettings={setExportSettings}
                status={exportStatus}
                transparent={transparent}
                mp4Available={mp4Available}
                webmNative={webmNative}
                onExport={onExport}
                onCancel={() => abortRef.current?.abort()}
                song={song}
                includeAudio={includeAudio}
                setIncludeAudio={setIncludeAudio}
                fit={fit}
                onUseFit={() => fit && applyFit(fit)}
              />
              <PresetPanel
                cfg={cfg}
                apply={(p) =>
                  // Crops belong to the current photo, so a preset never overrides them.
                  setCfg((c) => ({ ...p, coverCrop: c.coverCrop, labelCrop: c.labelCrop }))
                }
              />
            </>
          )}
        </div>
      </aside>

      <main className="main">
        <div className="toolbar">
          <div className="segmented" role="radiogroup" aria-label="Qué reproducir">
            {modes.map(([m, name, title, enabled]) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                className={mode === m ? 'on' : ''}
                title={title}
                disabled={!enabled}
                onClick={() => restart(m)}
              >
                {m === 'song' && <Icon name="music" size={13} />} {name}
              </button>
            ))}
          </div>
          <button type="button" className="icon-btn restart" onClick={() => setRestartKey((k) => k + 1)} title="Volver al inicio (Inicio)" aria-label="Volver al inicio">
            <Icon name="restart" />
          </button>
          <div className="spacer" />
          <span className="badge-info">
            {cfg.width}×{cfg.height} · {cfg.fps} fps
          </span>
          <button type="button" className="primary" onClick={() => setTab('export')}>
            <Icon name="export" size={16} />
            <span className="btn-text">{exportProgress !== null ? `Exportando ${exportProgress}%` : 'Exportar'}</span>
          </button>
        </div>
        <Preview
          cfg={cfg}
          images={images}
          mode={mode === 'song' && target === null ? 'introLoop' : mode}
          playing={playing}
          setPlaying={setPlaying}
          restartKey={restartKey}
          hasPhoto={!!cover}
          onPickPhoto={() => fileRef.current?.click()}
          audio={audio}
          songPlan={songPlan}
          songCtx={songCtx}
          seekRequest={seekRequest}
        />
      </main>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImage('cover', f);
          e.target.value = '';
        }}
      />
      {dragging && (
        <div className="drop-overlay" aria-hidden>
          <div>
            <Icon name="upload" size={32} />
            <b>Soltá una imagen (portada) o una canción</b>
          </div>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
