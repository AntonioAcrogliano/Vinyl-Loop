import { useState } from 'react';
import { downloadBlob } from '../export/common';
import type { SceneConfig } from '../render/types';
import { deletePreset, listPresets, presetFromFile, presetToJson, savePreset } from './presets';
import { Section } from './widgets';

interface Props {
  cfg: SceneConfig;
  /** Applies a preset, keeping the current output size and crops. */
  apply: (cfg: SceneConfig) => void;
}

export function PresetPanel({ cfg, apply }: Props) {
  const [presets, setPresets] = useState(listPresets);
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const refresh = () => setPresets(listPresets());

  return (
    <Section title="Presets" hint="Guardan toda la configuración (no las imágenes). Los recortes actuales se mantienen al cargar.">
      <div className="row pair2">
        <input type="text" placeholder="Nombre del preset" value={name} onChange={(e) => setName(e.target.value)} />
        <button
          className="secondary"
          disabled={!name.trim()}
          onClick={() => {
            const n = name.trim();
            setMsg(savePreset(n, cfg) ? `Guardado “${n}”.` : 'No se pudo guardar (almacenamiento bloqueado).');
            refresh();
            setSelected(n);
          }}
        >
          Guardar
        </button>
      </div>
      <div className="row pair2">
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">— Elegir preset —</option>
          {Object.keys(presets).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <button className="secondary" disabled={!presets[selected]} onClick={() => apply(presets[selected])}>
          Cargar
        </button>
      </div>
      <div className="button-row">
        <button
          className="secondary"
          disabled={!presets[selected]}
          onClick={() => {
            deletePreset(selected);
            setSelected('');
            refresh();
          }}
        >
          Borrar
        </button>
        <button
          className="secondary"
          onClick={() => {
            const n = selected || name.trim() || 'preset';
            const json = presetToJson(n, presets[selected] ?? cfg);
            downloadBlob(new Blob([json], { type: 'application/json' }), `${n.replace(/[^\w-]+/g, '_')}.vinilo.json`);
          }}
        >
          Exportar JSON
        </button>
        <label className="button secondary">
          Importar JSON
          <input
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                const p = await presetFromFile(f);
                savePreset(p.name, p.config);
                refresh();
                setSelected(p.name);
                apply(p.config);
                setMsg(`Importado “${p.name}”.`);
              } catch (err) {
                setMsg((err as Error).message);
              }
            }}
          />
        </label>
      </div>
      {msg && <p className="hint">{msg}</p>}
    </Section>
  );
}
