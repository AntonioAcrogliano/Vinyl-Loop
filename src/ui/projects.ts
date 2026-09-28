import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import type { ExportFormat } from '../export/common';
import type { Lyrics } from '../lyrics/lyrics';
import type { ExportPlan } from '../render/scene';
import { normalizeConfig, type SceneConfig } from '../render/types';

// Projects live in IndexedDB, in this browser only: the config plus the files that go with it
// (photo, label image, song) and the lyrics. They can also be exported as one .vinilo file.

export interface StoredFile {
  blob: Blob;
  name: string;
}

export interface ProjectData {
  cfg: SceneConfig;
  cover: StoredFile | null;
  label: StoredFile | null;
  song: StoredFile | null;
  lyrics: Lyrics | null;
  plan: ExportPlan;
  format: ExportFormat;
  includeAudio: boolean;
  autoFit: boolean;
  typedDuration: number | null;
}

export interface Project extends ProjectData {
  id: string;
  name: string;
  created: number;
  updated: number;
  /** Small picture for the list. */
  preview: Blob | null;
}

export type ProjectSummary = Pick<Project, 'id' | 'name' | 'updated' | 'preview'> & { hasSong: boolean };

const DB = 'vinilo-loop';
const STORE = 'projects';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('No se pudo abrir el almacenamiento del navegador'));
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result);
      t.onerror = t.onabort = () => reject(t.error ?? req.error ?? new Error('Error de almacenamiento'));
    });
  } finally {
    db.close();
  }
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const all = await tx<Project[]>('readonly', (s) => s.getAll());
  return all
    .map((p) => ({ id: p.id, name: p.name, updated: p.updated, preview: p.preview, hasSong: !!p.song }))
    .sort((a, b) => b.updated - a.updated);
}

export async function getProject(id: string): Promise<Project | null> {
  const p = await tx<Project | undefined>('readonly', (s) => s.get(id));
  return p ? { ...p, cfg: normalizeConfig(p.cfg) } : null;
}

/** Saves (creates or overwrites) a project. Asks the browser not to evict the storage. */
export async function saveProject(p: Project): Promise<void> {
  navigator.storage?.persist?.().catch(() => false);
  try {
    await tx('readwrite', (s) => s.put(p));
  } catch (err) {
    if ((err as DOMException)?.name === 'QuotaExceededError') throw new Error('No hay más espacio en el navegador. Borrá proyectos viejos.');
    throw err;
  }
}

export async function deleteProject(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}

export async function renameProject(id: string, name: string): Promise<void> {
  const p = await getProject(id);
  if (!p) return;
  await saveProject({ ...p, name, updated: Date.now() });
}

export const newProjectId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

// ---------- .vinilo file (zip) ----------

interface Manifest {
  app: 'vinilo-loop';
  kind: 'project';
  version: 1;
  name: string;
  data: Omit<ProjectData, 'cover' | 'label' | 'song'>;
  files: Partial<Record<'cover' | 'label' | 'song' | 'preview', { path: string; name: string; type: string }>>;
}

const MIME_EXT: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const extOf = (f: StoredFile) => MIME_EXT[f.blob.type] ?? /\.\w+$/.exec(f.name)?.[0] ?? '';

export async function projectToFile(p: Project): Promise<Blob> {
  const zip: Zippable = {};
  const files: Manifest['files'] = {};
  const add = async (key: 'cover' | 'label' | 'song' | 'preview', f: StoredFile | null) => {
    if (!f) return;
    const path = `${key}${extOf(f) || (key === 'preview' ? '.jpg' : '')}`;
    // Media is already compressed: store it as is.
    zip[path] = [new Uint8Array(await f.blob.arrayBuffer()), { level: 0 }];
    files[key] = { path, name: f.name, type: f.blob.type };
  };
  await add('cover', p.cover);
  await add('label', p.label);
  await add('song', p.song);
  await add('preview', p.preview ? { blob: p.preview, name: 'preview.jpg' } : null);
  const { cover: _c, label: _l, song: _s, preview: _p, id: _i, created: _cr, updated: _u, name, ...data } = p;
  const manifest: Manifest = { app: 'vinilo-loop', kind: 'project', version: 1, name, data, files };
  zip['project.json'] = strToU8(JSON.stringify(manifest, null, 2));
  return new Blob([zipSync(zip) as BlobPart], { type: 'application/zip' });
}

export async function projectFromFile(file: File): Promise<Project> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new Error('El archivo no es un proyecto de Vinilo Loop.');
  }
  const raw = entries['project.json'];
  const m = raw ? (JSON.parse(strFromU8(raw)) as Partial<Manifest>) : null;
  if (!m || m.app !== 'vinilo-loop' || m.kind !== 'project' || !m.data) throw new Error('El archivo no es un proyecto de Vinilo Loop.');
  const get = (key: 'cover' | 'label' | 'song' | 'preview'): StoredFile | null => {
    const f = m.files?.[key];
    const bytes = f && entries[f.path];
    return f && bytes ? { blob: new Blob([bytes as BlobPart], { type: f.type }), name: f.name } : null;
  };
  const now = Date.now();
  return {
    ...m.data,
    cfg: normalizeConfig(m.data.cfg),
    id: newProjectId(),
    name: m.name || file.name.replace(/\.[^.]+$/, ''),
    created: now,
    updated: now,
    cover: get('cover'),
    label: get('label'),
    song: get('song'),
    preview: get('preview')?.blob ?? null,
  };
}
