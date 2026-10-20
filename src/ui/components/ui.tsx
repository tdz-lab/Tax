import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { formatMoney, isValidDecimal, tryD } from '../../lib/decimal';
import { useApp } from '../AppContext';

export function Modal({ title, onClose, children, footer, size }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'small' | 'wide' }) {
  const ref = useRef<HTMLDivElement>(null);
  // Callers often pass a new onClose on every render; keep the latest in a ref so focus is set only once,
  // when the dialog opens — re-running this on each keystroke moved focus away from the field being typed in.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('.modal-body input:not([disabled]), .modal-body select:not([disabled]), .modal-body textarea:not([disabled])') ?? ref.current?.querySelector<HTMLElement>('button');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size ?? ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} ref={ref}>
        <div className="modal-head">
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="small" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({ title, message, confirmLabel = 'Confirm', danger, onConfirm, onCancel, requireText }: { title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onCancel: () => void; requireText?: string }) {
  const [typed, setTyped] = useState('');
  return (
    <Modal
      title={title}
      onClose={onCancel}
      size="small"
      footer={
        <>
          <button onClick={onCancel}>Cancel</button>
          <button className={danger ? 'danger solid' : 'primary'} disabled={!!requireText && typed !== requireText} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <div>{message}</div>
      {requireText && (
        <div className="field" style={{ marginTop: 10 }}>
          <label>
            Type <b>{requireText}</b> to confirm
          </label>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Confirmation text" />
        </div>
      )}
    </Modal>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={value === t.id ? 'active' : ''} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children, hint, error, className }: { label: ReactNode; children: (id: string) => ReactNode; hint?: ReactNode; error?: string | null; className?: string }) {
  const id = useId();
  return (
    <div className={`field ${error ? 'error' : ''} ${className ?? ''}`}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {error ? <span className="hint" style={{ color: 'var(--bad)' }}>{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function TextInput({ label, value, onChange, hint, className, placeholder, type = 'text', required, list, disabled }: { label: ReactNode; value: string | undefined; onChange: (v: string) => void; hint?: ReactNode; className?: string; placeholder?: string; type?: string; required?: boolean; list?: string; disabled?: boolean }) {
  return (
    <Field label={<>{label}{required && <span aria-hidden> *</span>}</>} hint={hint} className={className}>
      {(id) => <input id={id} type={type} value={value ?? ''} placeholder={placeholder} list={list} required={required} disabled={disabled} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

/** Adds thousands separators to the whole-number part of a typed number, keeping its decimals exactly as typed. */
export function groupDigits(v: string): string {
  const m = /^(-?)(\d+)(\.\d*)?$/.exec(v.trim().replace(/,/g, ''));
  return m ? `${m[1]}${m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${m[3] ?? ''}` : v;
}

/** Decimal input kept as a string (never converted through floating point). Shows 1,000 separators when not being edited. */
export function DecimalInput({ label, value, onChange, hint, className, allowNegative, placeholder, required }: { label: ReactNode; value: string | undefined; onChange: (v: string | undefined) => void; hint?: ReactNode; className?: string; allowNegative?: boolean; placeholder?: string; required?: boolean }) {
  const [raw, setRaw] = useState(groupDigits(value ?? ''));
  useEffect(() => {
    if ((tryD(raw)?.toString() ?? '') !== (tryD(value)?.toString() ?? '')) setRaw(groupDigits(value ?? ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const strict = (v: string) => /^-?(\d+\.?\d*|\.\d+)$/.test(v.trim().replace(/,/g, '')) && isValidDecimal(v);
  const bad = raw !== '' && (!strict(raw) || (!allowNegative && tryD(raw)?.isNegative()));
  return (
    <Field label={<>{label}{required && <span aria-hidden> *</span>}</>} hint={hint} className={className} error={bad ? (allowNegative ? 'Enter a number' : 'Enter a non-negative number') : null}>
      {(id) => (
        <input
          id={id}
          inputMode="decimal"
          value={raw}
          placeholder={placeholder}
          onChange={(e) => {
            const v = e.target.value;
            setRaw(v);
            if (v.trim() === '') onChange(undefined);
            else if (strict(v) && (allowNegative || !tryD(v)!.isNegative())) onChange(tryD(v)!.toString());
          }}
          onBlur={() => setRaw((r) => groupDigits(r))}
        />
      )}
    </Field>
  );
}

/** Drop-down. Options with a `group` are shown under that heading (consecutive options share one heading). */
export function Select<T extends string>({ label, value, onChange, options, hint, className, includeEmpty, required, disabled }: { label: ReactNode; value: T | undefined | ''; onChange: (v: T) => void; options: { value: T; label: string; group?: string }[]; hint?: ReactNode; className?: string; includeEmpty?: string; required?: boolean; disabled?: boolean }) {
  const runs: { group?: string; items: typeof options }[] = [];
  for (const o of options) {
    const last = runs[runs.length - 1];
    if (last && last.group === o.group) last.items.push(o);
    else runs.push({ group: o.group, items: [o] });
  }
  const opt = (o: (typeof options)[number]) => (
    <option key={o.value} value={o.value}>
      {o.label}
    </option>
  );
  return (
    <Field label={<>{label}{required && <span aria-hidden> *</span>}</>} hint={hint} className={className}>
      {(id) => (
        <select id={id} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
          {includeEmpty !== undefined && <option value="">{includeEmpty}</option>}
          {runs.map((r, i) =>
            r.group ? (
              <optgroup key={`${r.group}-${i}`} label={r.group}>
                {r.items.map(opt)}
              </optgroup>
            ) : (
              r.items.map(opt)
            )
          )}
        </select>
      )}
    </Field>
  );
}

export function Check({ label, checked, onChange, hint }: { label: ReactNode; checked: boolean | undefined; onChange: (v: boolean) => void; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className="field" style={{ justifyContent: 'flex-end' }}>
      <label htmlFor={id} style={{ display: 'flex', gap: 6, alignItems: 'center', color: 'var(--text)', fontSize: 12.5 }}>
        <input id={id} type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Money({ value, currency = 'AUD', incompleteLabel = 'incomplete' }: { value: string | null | undefined; currency?: string; incompleteLabel?: string }) {
  if (value === null) return <span className="badge bad">{incompleteLabel}</span>;
  if (value === undefined) return <span className="faint">—</span>;
  const d = tryD(value);
  return <span className={d?.isNegative() ? 'neg' : ''}>{formatMoney(value, currency)}</span>;
}

export function Stat({ label, value, sub, onClick, tone }: { label: string; value: ReactNode; sub?: ReactNode; onClick?: () => void; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className={`stat ${onClick ? 'link' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} onKeyDown={(e) => onClick && (e.key === 'Enter' || e.key === ' ') && onClick()}>
      <div className="label">{label}</div>
      <div className="value" style={tone ? { color: `var(--${tone})` } : undefined}>
        {value}
      </div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    recorded: 'accent',
    calculated: 'accent',
    estimate: 'warn',
    review: 'warn',
    incomplete: 'bad',
    blocking: 'bad',
    warning: 'warn',
    info: '',
    ready_for_agent_review: 'ok',
    needs_attention: 'warn',
    verified: 'ok',
    partially_verified: 'warn',
    unverified: 'bad',
    committed: 'ok',
    rolled_back: '',
    failed: 'bad',
    open: 'warn',
    reconciled: 'ok',
    explained: 'accent',
    planned: ''
  };
  return <span className={`badge ${map[status] ?? ''}`}>{status.replace(/_/g, ' ')}</span>;
}

export function Toasts() {
  const { toasts, dismiss } = useApp();
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind === 'bad' ? 'bad' : ''}`}>
          <span style={{ flex: 1 }}>{t.message}</span>
          {t.undo && (
            <button
              className="small"
              onClick={async () => {
                await t.undo!();
                dismiss(t.id);
              }}
            >
              Undo
            </button>
          )}
          <button className="small" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Disclaimer() {
  return (
    <div className="disclaimer">
      Preparation tool for review by a registered tax agent — not tax advice, not ATO-certified and cannot lodge returns. Estimates depend on your data and the assumptions shown.
    </div>
  );
}
