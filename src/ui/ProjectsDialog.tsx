import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './icons';
import { deleteProject, listProjects, renameProject, type ProjectSummary } from './projects';

interface Props {
  /** The open project, if it was saved. */
  current: { id: string; name: string } | null;
  dirty: boolean;
  /** Suggested name for a project that was never saved. */
  suggestedName: string;
  onSave: (name: string, asCopy: boolean) => Promise<void>;
  onOpen: (id: string) => Promise<void>;
  onNew: () => void;
  onImport: (file: File) => Promise<void>;
  onExportFile: () => Promise<void>;
  /** A project was deleted (the open one becomes unsaved). */
  onDeleted: (id: string) => void;
  onClose: () => void;
}

const dateFmt = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function ProjectsDialog(p: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const [name, setName] = useState(p.current?.name ?? p.suggestedName);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  const refresh = () =>
    listProjects()
      .then(setList)
      .catch((err) => {
        setList([]);
        setMsg({ text: `No se puede usar el almacenamiento del navegador: ${(err as Error).message}`, error: true });
      });

  const onCloseRef = useRef(p.onClose);
  onCloseRef.current = p.onClose;
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    // Esc, the ✕ button and closing after an action all end here.
    const onClose = () => onCloseRef.current();
    d.addEventListener('close', onClose);
    d.showModal();
    refresh();
    return () => d.removeEventListener('close', onClose);
  }, []);

  // Closing does not wait for the dialog's close event (it is delayed in background tabs).
  const close = () => {
    ref.current?.close();
    p.onClose();
  };

  const urls = useMemo(() => new Map((list ?? []).map((s) => [s.id, s.preview ? URL.createObjectURL(s.preview) : ''])), [list]);
  useEffect(() => () => urls.forEach((u) => u && URL.revokeObjectURL(u)), [urls]);

  const run = async (label: string, fn: () => Promise<void>, ok?: string) => {
    setBusy(label);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg({ text: ok });
      await refresh();
    } catch (err) {
      setMsg({ text: (err as Error).message, error: true });
    } finally {
      setBusy('');
    }
  };

  const confirmDiscard = () => !p.dirty || window.confirm('El proyecto actual tiene cambios sin guardar. ¿Seguir igual?');

  return (
    <dialog ref={ref} className="projects" aria-labelledby="projects-title">
      <header>
        <h2 id="projects-title">Proyectos</h2>
        <button type="button" className="icon-btn" aria-label="Cerrar" onClick={close}>
          ✕
        </button>
      </header>

      <form
        className="row pair2 save-row"
        onSubmit={(e) => {
          e.preventDefault();
          const n = name.trim() || p.suggestedName;
          run('save', () => p.onSave(n, false), `Guardado “${n}”.`);
        }}
      >
        <input type="text" value={name} maxLength={80} placeholder="Nombre del proyecto" onChange={(e) => setName(e.target.value)} aria-label="Nombre del proyecto" />
        <button type="submit" className="primary" disabled={!!busy}>
          {busy === 'save' ? 'Guardando…' : p.current ? 'Guardar' : 'Guardar proyecto'}
        </button>
      </form>
      <div className="button-row">
        {p.current && (
          <button
            type="button"
            className="secondary"
            disabled={!!busy}
            onClick={() => {
              const n = `${name.trim() || p.suggestedName} (copia)`;
              run('copy', () => p.onSave(n, true), `Guardado como “${n}”.`);
            }}
          >
            Guardar una copia
          </button>
        )}
        <button
          type="button"
          className="secondary"
          disabled={!!busy}
          onClick={() => {
            if (!confirmDiscard()) return;
            p.onNew();
            close();
          }}
        >
          Nuevo proyecto
        </button>
        <button type="button" className="secondary" disabled={!!busy || !p.current} title={p.current ? undefined : 'Guardalo primero'} onClick={() => run('export', p.onExportFile)}>
          Exportar .vinilo
        </button>
        <label className={busy ? 'button secondary disabled' : 'button secondary'}>
          Importar .vinilo
          <input
            type="file"
            accept=".vinilo,application/zip"
            hidden
            disabled={!!busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f || !confirmDiscard()) return;
              run('import', () => p.onImport(f), `Importado “${f.name}”.`);
            }}
          />
        </label>
      </div>
      {msg && <p className={msg.error ? 'hint warn' : 'hint ok'}>{msg.text}</p>}

      <div className="project-list">
        {list === null && <p className="hint">Cargando…</p>}
        {list?.length === 0 && <p className="hint">Todavía no guardaste ningún proyecto.</p>}
        {list?.map((s) => {
          const isCurrent = s.id === p.current?.id;
          return (
            <div key={s.id} className={isCurrent ? 'project on' : 'project'}>
              <button
                type="button"
                className="project-open"
                disabled={!!busy}
                title="Abrir"
                onClick={() => {
                  if (!isCurrent && !confirmDiscard()) return;
                  run('open', async () => {
                    await p.onOpen(s.id);
                    close();
                  });
                }}
              >
                {urls.get(s.id) ? <img src={urls.get(s.id)} alt="" /> : <span className="noimg" />}
              </button>
              <div className="project-info">
                {renaming?.id === s.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const n = renaming.name.trim();
                      setRenaming(null);
                      if (n) run('rename', () => renameProject(s.id, n)).then(() => isCurrent && setName(n));
                    }}
                  >
                    <input
                      type="text"
                      autoFocus
                      value={renaming.name}
                      maxLength={80}
                      onChange={(e) => setRenaming({ id: s.id, name: e.target.value })}
                      onBlur={(e) => e.currentTarget.form?.requestSubmit()}
                      aria-label="Nuevo nombre"
                    />
                  </form>
                ) : (
                  <b title={s.name}>{s.name}</b>
                )}
                <small>
                  {dateFmt.format(s.updated)}
                  {s.hasSong && ' · con canción'}
                  {isCurrent && ' · abierto'}
                </small>
                <div className="project-actions">
                  <button type="button" className="link" onClick={() => setRenaming({ id: s.id, name: s.name })}>
                    Renombrar
                  </button>
                  {confirmId === s.id ? (
                    <button
                      type="button"
                      className="link danger"
                      onClick={() => {
                        setConfirmId(null);
                        run('delete', () => deleteProject(s.id).then(() => p.onDeleted(s.id)), `Borrado “${s.name}”.`);
                      }}
                    >
                      ¿Borrar? Sí
                    </button>
                  ) : (
                    <button type="button" className="link" onClick={() => setConfirmId(s.id)}>
                      Borrar
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="hint">
        <Icon name="presets" size={12} /> Se guardan en este navegador: foto, canción, letra y todos los ajustes. Para pasarlos a otra compu, exportá el
        archivo .vinilo.
      </p>
    </dialog>
  );
}
