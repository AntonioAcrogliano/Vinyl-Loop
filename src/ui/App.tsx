import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExportCancelled, canvasFactory, downloadBlob, type ExportJob, type ExportResult } from '../export/common';
import { getBackground } from '../render/backgrounds';
import { timingFor } from '../render/scene';
import { DEFAULT_CONFIG, DEFAULT_CROP, type SceneConfig } from '../render/types';
import { extractPalette } from '../utils/palette';
import { BackgroundPanel } from './BackgroundPanel';
import { Controls, type LoadedImage } from './Controls';
import { ExportPanel, type ExportSettings, type ExportStatus } from './ExportPanel';
import { PresetPanel } from './PresetPanel';
import { Preview, type PreviewMode } from './Preview';

async function loadImage(file: File): Promise<LoadedImage> {
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

export function App() {
  const [cfg, setCfg] = useState<SceneConfig>(DEFAULT_CONFIG);
  const [cover, setCover] = useState<LoadedImage | null>(null);
  const [label, setLabel] = useState<LoadedImage | null>(null);
  const [mode, setMode] = useState<PreviewMode>('introLoop');
  const [playing, setPlaying] = useState(true);
  const [restartKey, setRestartKey] = useState(0);
  const [exportSettings, setExportSettings] = useState<ExportSettings>({
    plan: { intro: true, loops: 1, outro: false },
    format: 'mp4',
  });
  const [exportStatus, setExportStatus] = useState<ExportStatus>(IDLE);
  const [mp4Available, setMp4Available] = useState<boolean | null>(null);
  const [webmNative, setWebmNative] = useState<boolean | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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

  const onImage = async (kind: 'cover' | 'label', file: File) => {
    try {
      const img = await loadImage(file);
      if (kind === 'cover') {
        setCover(img);
        update({ coverCrop: DEFAULT_CROP });
      } else {
        setLabel(img);
        update({ labelCrop: DEFAULT_CROP });
      }
    } catch {
      setExportStatus({ ...IDLE, message: `No pude abrir "${file.name}".` });
    }
  };

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
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      const mb = (res.blob.size / 1e6).toFixed(1);
      setExportStatus({ ...IDLE, message: `Listo: ${res.filename} (${mb} MB, ${secs} s)` });
    } catch (err) {
      const msg = err instanceof ExportCancelled || ac.signal.aborted ? 'Exportación cancelada.' : `Error: ${(err as Error).message}`;
      setExportStatus({ ...IDLE, message: msg });
    } finally {
      abortRef.current = null;
    }
  };

  const restart = (m: PreviewMode) => {
    setMode(m);
    setRestartKey((k) => k + 1);
  };

  return (
    <div className="app">
      <aside className="controls">
        <header className="brand">
          <h1>Vinilo Loop</h1>
          <p>Todo corre en tu navegador: la foto nunca sale de tu máquina.</p>
        </header>
        <Controls cfg={cfg} update={update} timing={timing} cover={cover} label={label} onImage={onImage} />
        <BackgroundPanel cfg={cfg} update={update} photoPalette={photoPalette} />
        <PresetPanel
          cfg={cfg}
          apply={(p) =>
            // Crops belong to the current photo, so a preset never overrides them.
            setCfg((c) => ({ ...p, coverCrop: c.coverCrop, labelCrop: c.labelCrop }))
          }
        />
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
      </aside>
      <main className="main">
        <div className="toolbar">
          <div className="segmented">
            <button className={mode === 'loop' ? 'on' : ''} onClick={() => restart('loop')}>
              Loop repetido
            </button>
            <button className={mode === 'introLoop' ? 'on' : ''} disabled={!cfg.introEnabled} onClick={() => restart('introLoop')}>
              Intro + loop
            </button>
            <button className={mode === 'full' ? 'on' : ''} disabled={!cfg.introEnabled && !cfg.outroEnabled} onClick={() => restart('full')}>
              Completo
            </button>
          </div>
          <button className="secondary" onClick={() => setPlaying((p) => !p)}>
            {playing ? 'Pausa' : 'Play'}
          </button>
          <button className="secondary" onClick={() => setRestartKey((k) => k + 1)}>
            Reiniciar
          </button>
        </div>
        <Preview cfg={cfg} images={images} mode={mode} playing={playing} restartKey={restartKey} />
      </main>
    </div>
  );
}
