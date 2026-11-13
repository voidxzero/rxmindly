import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { iconOf } from '../lib/logic';
import { cssColor, type Med, type MedColor, type MedIcon } from '../lib/types';

// ---------------------------------------------------------------------------
// Back handling: the Android back button closes the topmost open sheet.

const backStack: (() => void)[] = [];

export function handleBack(): boolean {
  const top = backStack[backStack.length - 1];
  if (!top) return false;
  top();
  return true;
}

function useBack(handler: () => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const entry = () => ref.current();
    backStack.push(entry);
    return () => {
      const i = backStack.indexOf(entry);
      if (i >= 0) backStack.splice(i, 1);
    };
  }, []);
}

// ---------------------------------------------------------------------------

export function Sheet(props: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useBack(props.onClose);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="sheet"
      onCancel={(e) => {
        e.preventDefault();
        props.onClose();
      }}
      onMouseDown={(e) => {
        if (e.target === ref.current) props.onClose();
      }}
    >
      <div className="sheet-panel">
        <header className="sheet-head">
          <div>
            <h2>{props.title}</h2>
            {props.subtitle && <p className="muted">{props.subtitle}</p>}
          </div>
          <button className="icon-btn" onClick={props.onClose} aria-label="Close">
            <X size={22} />
          </button>
        </header>
        <div className="sheet-body">{props.children}</div>
        {props.footer && <footer className="sheet-foot">{props.footer}</footer>}
      </div>
    </dialog>
  );
}

/** A pharmacy bottle, filled to show how much is left. */
export function Bottle({ color, fill, size = 56 }: { color: MedColor; fill: number; size?: number }) {
  const top = 22;
  const height = 38;
  const level = Math.max(0, Math.min(1, fill)) * height;
  const clip = `bottle-${color.replace('#', '')}-${Math.round(fill * 100)}`;
  return (
    <svg className="bottle" width={size * 0.75} height={size} viewBox="0 0 48 64" style={{ color: cssColor(color) }} aria-hidden="true">
      <defs>
        <clipPath id={clip}>
          <rect x="6" y={top - 4} width="36" height={height + 4} rx="7" />
        </clipPath>
      </defs>
      <rect x="11" y="2" width="26" height="11" rx="3" fill="currentColor" />
      <rect x="15" y="13" width="18" height="6" fill="currentColor" opacity="0.55" />
      <rect x="6" y={top - 4} width="36" height={height + 4} rx="7" fill="currentColor" opacity="0.16" />
      <rect x="6" y={top + height - level} width="36" height={level} fill="currentColor" opacity="0.8" clipPath={`url(#${clip})`} />
      <rect x="6" y={top - 4} width="36" height={height + 4} rx="7" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="12" y="30" width="24" height="16" rx="2" fill="var(--surface)" opacity="0.92" />
      <rect x="15" y="34" width="14" height="2.5" rx="1.25" fill="currentColor" opacity="0.7" />
      <rect x="15" y="39.5" width="18" height="2.5" rx="1.25" fill="currentColor" opacity="0.35" />
    </svg>
  );
}

export const ICON_LABELS: Record<MedIcon, string> = {
  round: 'Round tablet',
  oval: 'Oval tablet',
  caplet: 'Caplet',
  capsule: 'Capsule',
  softgel: 'Softgel',
  liquid: 'Liquid',
  drops: 'Drops',
  syringe: 'Injection',
  inhaler: 'Inhaler',
  tube: 'Cream',
  patch: 'Patch',
};

/** The shapes are drawn solid; `hollow` (an emptied spot) draws the outline only. */
function iconShape(icon: MedIcon, hollow: boolean) {
  const body = hollow ? { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinejoin: 'round' as const } : { fill: 'currentColor' };
  const detail = { fill: 'none', stroke: hollow ? 'currentColor' : 'var(--surface)', strokeWidth: 1.6, strokeLinecap: 'round' as const };
  const tilt = 'rotate(-35 12 12)';
  switch (icon) {
    case 'round':
      return (
        <>
          <circle cx="12" cy="12" r="8.5" {...body} />
          <path d="M7.5 15.2 16.5 8.8" {...detail} />
        </>
      );
    case 'oval':
      return <ellipse cx="12" cy="12" rx="10" ry="6.2" transform={tilt} {...body} />;
    case 'caplet':
      return (
        <g transform={tilt}>
          <rect x="1.5" y="7.5" width="21" height="9" rx="3" {...body} />
          <path d="M12 9.5v5" {...detail} />
        </g>
      );
    case 'capsule':
      return (
        <g transform={tilt}>
          {hollow ? (
            <>
              <rect x="1.5" y="7.5" width="21" height="9" rx="4.5" {...body} />
              <path d="M12 7.5v9" {...detail} />
            </>
          ) : (
            <>
              <rect x="1.5" y="7.5" width="21" height="9" rx="4.5" fill="currentColor" opacity="0.45" />
              <path d="M6 7.5h6v9H6a4.5 4.5 0 0 1 0-9z" fill="currentColor" />
            </>
          )}
        </g>
      );
    case 'softgel':
      return (
        <g transform={tilt}>
          <ellipse cx="12" cy="12" rx="9.5" ry="6.5" {...body} />
          <path d="M6.5 10.5c1.2-1.6 3-2.4 5-2.5" {...detail} opacity="0.8" />
        </g>
      );
    case 'liquid':
      return (
        <>
          <path d="M5.5 6h13l-1.6 12.3a2 2 0 0 1-2 1.7H9.1a2 2 0 0 1-2-1.7z" {...body} />
          <path d="M8.5 11.5h7" {...detail} />
        </>
      );
    case 'drops':
      return <path d="M12 2.5c-2.6 3.6-6 7.8-6 11.5a6 6 0 0 0 12 0c0-3.7-3.4-7.9-6-11.5z" {...body} />;
    case 'syringe':
      return (
        <g transform="rotate(45 12 12)">
          <rect x="8.5" y="7" width="7" height="10.5" rx="1.5" {...body} />
          <path d="M12 7V2.5M8.5 2.5h7M12 17.5V23" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </g>
      );
    case 'inhaler':
      return <path d="M9.5 5a2 2 0 0 1 2-2h3.5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-3.5a2 2 0 0 1 2-2h2.5z" {...body} />;
    case 'tube':
      return (
        <>
          <path d="M6 3h12l-2.2 13.5H8.2z" {...body} />
          <rect x="9.5" y="17.5" width="5" height="3.5" rx="1" {...body} />
        </>
      );
    case 'patch':
      return (
        <>
          <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" {...body} />
          <rect x="8.5" y="8.5" width="7" height="7" rx="1.5" {...detail} />
        </>
      );
  }
}

/** The little picture of a medicine: its shape, in its bottle color. */
export function PillMark({ med, hollow = false }: { med: Pick<Med, 'color' | 'form' | 'icon'>; hollow?: boolean }) {
  return (
    <svg className={`pill-mark${hollow ? ' hollow' : ''}`} viewBox="0 0 24 24" style={{ color: cssColor(med.color) }} aria-hidden="true">
      {iconShape(iconOf(med), hollow)}
    </svg>
  );
}

export function Field(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{props.label}</span>
      {props.children}
      {props.hint && <span className="field-hint">{props.hint}</span>}
    </label>
  );
}

/** A number box that tolerates being empty while you type. */
export function NumberInput(props: {
  value: number | null;
  onChange: (value: number | null) => void;
  placeholder?: string;
  decimal?: boolean;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(props.value == null ? '' : String(props.value));
  useEffect(() => {
    const parsed = text.trim() === '' ? null : Number(text);
    if (parsed !== props.value) setText(props.value == null ? '' : String(props.value));
    // Only resync when the value changes from outside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.value]);
  return (
    <input
      className="input"
      inputMode={props.decimal ? 'decimal' : 'numeric'}
      value={text}
      placeholder={props.placeholder}
      aria-label={props.ariaLabel}
      onChange={(e) => {
        const next = e.target.value.replace(',', '.');
        if (!/^\d*\.?\d*$/.test(next)) return;
        setText(next);
        const parsed = next.trim() === '' || next === '.' ? null : Number(next);
        props.onChange(parsed != null && Number.isFinite(parsed) ? parsed : null);
      }}
    />
  );
}

export function Stepper(props: { value: number; onChange: (v: number) => void; step?: number; min?: number; label: string }) {
  const step = props.step ?? 1;
  const min = props.min ?? step;
  const round = (n: number) => Math.round(n * 100) / 100;
  return (
    <div className="stepper" role="group" aria-label={props.label}>
      <button type="button" onClick={() => props.onChange(Math.max(min, round(props.value - step)))} aria-label="Less" disabled={props.value <= min}>
        −
      </button>
      <span>{round(props.value)}</span>
      <button type="button" onClick={() => props.onChange(round(props.value + step))} aria-label="More">
        +
      </button>
    </div>
  );
}

/** Re-renders on the minute so "overdue" and the current day stay right. */
export function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 30_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  return now;
}
