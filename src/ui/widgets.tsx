import { useState, type ReactNode } from 'react';

export function Section({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={open ? 'section' : 'section closed'}>
      <h2>
        <button className="section-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span>{title}</span>
          <span className="chev" aria-hidden>
            {open ? '−' : '+'}
          </span>
        </button>
      </h2>
      {open && children}
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
  return (
    <label className="row">
      <span>{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
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

export function Check(props: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={props.disabled ? 'check disabled' : 'check'}>
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      {props.label}
    </label>
  );
}

export const pct = (v: number) => `${Math.round(v * 100)}%`;
