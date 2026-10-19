/** Schema-driven editor for reference entities (accounts, instruments, assets, logs…). Existing records autosave. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { saveEntity, deleteEntity } from '../../services/ledger';
import { useApp } from '../AppContext';
import { Check, Confirm, DecimalInput, Modal, Select, TextInput } from './ui';

export interface FieldSpec<T> {
  key: keyof T & string;
  label: string;
  type: 'text' | 'date' | 'decimal' | 'signed' | 'select' | 'check' | 'textarea' | 'int';
  options?: { value: string; label: string }[];
  required?: boolean;
  hint?: string;
  span?: 2 | 4;
  show?: (r: Partial<T>) => boolean;
  includeEmpty?: string;
}

type Table = Parameters<typeof saveEntity>[0];

export function EntityModal<T extends { id: string }>({
  title,
  table,
  initial,
  fields,
  onClose,
  validate,
  extra,
  isNew,
  afterSave
}: {
  title: string;
  table: Table;
  initial: Partial<T> & { id: string };
  fields: FieldSpec<T>[];
  onClose: () => void;
  validate?: (r: Partial<T>) => string[];
  extra?: (r: Partial<T>) => ReactNode;
  isNew: boolean;
  afterSave?: (r: T) => Promise<void> | void;
}) {
  const { run, reportSave, toast } = useApp();
  const [rec, setRec] = useState<Partial<T>>(initial);
  const [created, setCreated] = useState(!isNew);
  const [errors, setErrors] = useState<string[]>([]);
  const [confirmDel, setConfirmDel] = useState(false);
  const dirty = useRef(false);
  const check = (r: Partial<T>) => {
    const errs = fields.filter((f) => f.required && (f.show?.(r) ?? true) && (r[f.key] === undefined || r[f.key] === '' || r[f.key] === null)).map((f) => `${f.label} is required.`);
    return [...errs, ...(validate?.(r) ?? [])];
  };
  const save = async (r: Partial<T>) => {
    const errs = check(r);
    setErrors(errs);
    if (errs.length) return false;
    reportSave('saving');
    try {
      const saved = await saveEntity(table, r as T);
      await afterSave?.(saved);
      reportSave('saved');
      dirty.current = false;
      return true;
    } catch (e) {
      reportSave('failed', (e as Error).message);
      toast(`Save failed: ${(e as Error).message}`, { kind: 'bad' });
      return false;
    }
  };
  useEffect(() => {
    if (!created || !dirty.current) return;
    const h = setTimeout(() => void save(rec), 600);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec, created]);
  const set = (k: string, v: unknown) => {
    dirty.current = true;
    setRec((r) => ({ ...r, [k]: v }));
  };
  return (
    <Modal
      title={title}
      onClose={async () => {
        if (created && dirty.current) await save(rec);
        onClose();
      }}
      footer={
        <>
          {created && (
            <button className="danger" onClick={() => setConfirmDel(true)} style={{ marginRight: 'auto' }}>
              Delete
            </button>
          )}
          {!created ? (
            <button
              className="primary"
              onClick={async () => {
                if (await save(rec)) {
                  setCreated(true);
                  toast('Added — further changes save automatically.');
                }
              }}
            >
              Add
            </button>
          ) : (
            <span className="muted">Changes save automatically</span>
          )}
          <button onClick={onClose}>Close</button>
        </>
      }
    >
      {errors.length > 0 && (
        <div className="notice bad">
          {errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      )}
      <div className="form-grid">
        {fields
          .filter((f) => f.show?.(rec) ?? true)
          .map((f) => {
            const cls = f.span === 4 ? 'span-4' : f.span === 2 ? 'span-2' : undefined;
            const v = rec[f.key] as any;
            switch (f.type) {
              case 'decimal':
              case 'signed':
                return <DecimalInput key={f.key} label={f.label} value={v} onChange={(x) => set(f.key, x)} hint={f.hint} className={cls} allowNegative={f.type === 'signed'} required={f.required} />;
              case 'int':
                return <TextInput key={f.key} label={f.label} type="number" value={v === undefined ? '' : String(v)} onChange={(x) => set(f.key, x === '' ? undefined : Number(x))} hint={f.hint} className={cls} required={f.required} />;
              case 'select':
                return <Select key={f.key} label={f.label} value={v ?? ''} onChange={(x) => set(f.key, x === '' ? undefined : x)} options={f.options ?? []} hint={f.hint} className={cls} includeEmpty={f.includeEmpty} required={f.required} />;
              case 'check':
                return <Check key={f.key} label={f.label} checked={!!v} onChange={(x) => set(f.key, x)} hint={f.hint} />;
              case 'textarea':
                return (
                  <div key={f.key} className="field span-4">
                    <label htmlFor={`f-${f.key}`}>{f.label}</label>
                    <textarea id={`f-${f.key}`} value={v ?? ''} onChange={(e) => set(f.key, e.target.value || undefined)} />
                  </div>
                );
              default:
                return <TextInput key={f.key} label={f.label} type={f.type === 'date' ? 'date' : 'text'} value={v ?? ''} onChange={(x) => set(f.key, x === '' ? undefined : x)} hint={f.hint} className={cls} required={f.required} />;
            }
          })}
      </div>
      {extra?.(rec)}
      {confirmDel && (
        <Confirm
          title="Delete"
          danger
          message="Delete this record? This is recorded in the audit history."
          onCancel={() => setConfirmDel(false)}
          onConfirm={async () => {
            await run(() => deleteEntity(table, rec.id!), { success: 'Deleted.' });
            onClose();
          }}
        />
      )}
    </Modal>
  );
}
