import type { ReactNode } from 'react';

/** A titled group of controls inside a tab. */
export function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <section className="section">
      <h2>{title}</h2>
      {children}
      {hint && <p className="hint">{hint}</p>}
    </section>
  );
}

export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const pct = ((props.value - props.min) / (props.max - props.min)) * 100;
  return (
    <label className="row">
      <span>{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        style={{ '--fill': `${pct}%` } as React.CSSProperties}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <output>{props.format ? props.format(props.value) : props.value}</output>
    </label>
  );
}

export function Select<T extends string | number>(props: {
  label: string;
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
}) {
  const numeric = typeof props.value === 'number';
  return (
    <label className="row">
      <span>{props.label}</span>
      <select
        value={String(props.value)}
        onChange={(e) => props.onChange((numeric ? Number(e.target.value) : e.target.value) as T)}
      >
        {props.options.map((o) => (
          <option key={String(o.value)} value={String(o.value)} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Row of mutually exclusive buttons; better than a select for 2–5 short options. */
export function Segmented<T extends string | number>(props: {
  label?: string;
  value: T;
  options: { value: T; label: ReactNode; title?: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  full?: boolean;
}) {
  const control = (
    <div className={props.full ? 'segmented full' : 'segmented'} role="radiogroup" aria-label={props.label}>
      {props.options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === props.value}
          className={o.value === props.value ? 'on' : ''}
          title={o.title}
          disabled={o.disabled}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
  if (!props.label) return control;
  return (
    <div className="row seg-row">
      <span>{props.label}</span>
      {control}
    </div>
  );
}

export function Check(props: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string }) {
  return (
    <label className={props.disabled ? 'check disabled' : 'check'} title={props.hint}>
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span className="switch" aria-hidden />
      {props.label}
    </label>
  );
}

export function ColorField({ label, value, onChange, onReset }: { label: string; value: string; onChange: (v: string) => void; onReset?: () => void }) {
  return (
    <div className="row color-row">
      <span>{label}</span>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      {onReset ? (
        <button type="button" className="link" onClick={onReset}>
          Restablecer
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

export const pct = (v: number) => `${Math.round(v * 100)}%`;
