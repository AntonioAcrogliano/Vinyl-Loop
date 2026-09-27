import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExportCancelled, canvasFactory, downloadBlob, type ExportJob, type ExportResult } from '../export/common';
import { getBackground } from '../render/backgrounds';
import { timingFor } from '../render/scene';
import { DEFAULT_CONFIG, DEFAULT_CROP, type SceneConfig } from '../render/types';
import { extractPalette } from '../utils/palette';
import { BackgroundPanel } from './BackgroundPanel';
import { ExportPanel, type ExportSettings, type ExportStatus } from './ExportPanel';
import { Icon, type IconName } from './icons';
import { ImagePanel, type LoadedImage } from './ImagePanel';
import { MotionPanel } from './MotionPanel';
import { PresetPanel } from './PresetPanel';
import { Preview, type PreviewMode } from './Preview';
import { ScenePanel } from './ScenePanel';

async function loadImage(file: File): Promise<LoadedImage> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Formato no soportado');
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  return { bitmap, name: file.name.replace(/\.[^.]+$/, '') };
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

type Tab = 'image' | 'scene' | 'motion' | 'background' | 'presets' | 'export';
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'image', label: 'Imagen', icon: 'image' },
  { id: 'scene', label: 'Escena', icon: 'scene' },
  { id: 'motion', label: 'Movimiento', icon: 'motion' },
  { id: 'background', label: 'Fondo', icon: 'background' },
  { id: 'presets', label: 'Presets', icon: 'presets' },
  { id: 'export', label: 'Exportar', icon: 'export' },
];

export function App() {
  const [cfg, setCfg] = useState<SceneConfig>(DEFAULT_CONFIG);
  const [cover, setCover] = useState<LoadedImage | null>(null);
  const [label, setLabel] = useState<LoadedImage | null>(null);
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
    const id = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(id);
  }, [toast]);

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

  const onImage = useCallback(
    async (kind: 'cover' | 'label', file: File) => {
      try {
        const img = await loadImage(file);
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
    },
    [],
  );

  // Drop an image anywhere in the window to use it as the cover.
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
      if (f) onImage('cover', f);
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
  }, [onImage]);

  const onExport = async () => {
    const ac = new AbortController();
    abortRef.current = ac;
    const job: ExportJob = {
      cfg,
      images,
      plan: effective.plan,
      format: effective.format,
      name: cover?.name ?? 'vinilo',
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
            </button>
          ))}
        </nav>
        <div className="panel" role="tabpanel">
          {tab === 'image' && <ImagePanel cfg={cfg} update={update} cover={cover} label={label} onImage={onImage} />}
          {tab === 'scene' && <ScenePanel cfg={cfg} update={update} />}
          {tab === 'motion' && <MotionPanel cfg={cfg} update={update} timing={timing} />}
          {tab === 'background' && <BackgroundPanel cfg={cfg} update={update} photoPalette={photoPalette} />}
          {tab === 'presets' && (
            <PresetPanel
              cfg={cfg}
              apply={(p) =>
                // Crops belong to the current photo, so a preset never overrides them.
                setCfg((c) => ({ ...p, coverCrop: c.coverCrop, labelCrop: c.labelCrop }))
              }
            />
          )}
          {tab === 'export' && (
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
            />
          )}
        </div>
      </aside>

      <main className="main">
        <div className="toolbar">
          <div className="segmented" role="radiogroup" aria-label="Qué reproducir">
            {(
              [
                ['loop', 'Loop', 'Solo el loop, repetido: para chequear el empalme'],
                ['introLoop', 'Intro + loop', 'La intro una vez y después el loop'],
                ['full', 'Completo', 'Intro, dos loops y outro'],
              ] as const
            ).map(([m, name, title]) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                className={mode === m ? 'on' : ''}
                title={title}
                disabled={(m === 'introLoop' && !cfg.introEnabled) || (m === 'full' && !cfg.introEnabled && !cfg.outroEnabled)}
                onClick={() => restart(m)}
              >
                {name}
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
          mode={mode}
          playing={playing}
          setPlaying={setPlaying}
          restartKey={restartKey}
          hasPhoto={!!cover}
          onPickPhoto={() => fileRef.current?.click()}
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
            <b>Soltá la imagen para usarla de portada</b>
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
