/** "Move money" between your own accounts — from, to, date, amount, note. One entry; never income or an expense. */
import { useEffect, useState } from 'react';
import type { Transaction } from '../../domain/types';
import { D } from '../../lib/decimal';
import { fyEnd, fyStart } from '../../lib/dates';
import { isTradingAccountType } from '../../domain/reference';
import { deleteMove, loadMove, saveMove, type Move } from '../../services/moves';
import { useApp } from '../AppContext';
import { useAccounts } from '../hooks';
import { Confirm, DecimalInput, Modal, Select, TextInput } from './ui';

export function MoveMoneyModal({ fromAccountId, record, onClose }: { fromAccountId?: string; record?: Transaction; onClose: () => void }) {
  const { run, fy, settings } = useApp();
  const all = useAccounts();
  const today = new Date().toISOString().slice(0, 10);
  const inYear = today >= fyStart(fy) && today <= fyEnd(fy) ? today : fyEnd(fy);
  const [existing, setExisting] = useState<Move | null>(null);
  const [loading, setLoading] = useState(!!record);
  const [f, setF] = useState({ from: fromAccountId ?? '', to: '', date: inYear, amount: undefined as string | undefined, currency: '', note: '' });
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    if (!record) return;
    void loadMove(record).then((m) => {
      if (m) {
        setExisting(m);
        setF({ from: m.fromAccountId, to: m.toAccountId, date: m.date, amount: m.amount, currency: m.currency, note: m.note ?? '' });
      }
      setLoading(false);
    });
  }, [record]);

  const usable = all.filter((a) => !a.deletedAt && (!a.archived || a.id === f.from || a.id === f.to));
  // Banks and payment accounts first, then the rest (e.g. moving money to a broker or exchange).
  const sorted = [...usable].sort((a, b) => Number(isTradingAccountType(a.type)) - Number(isTradingAccountType(b.type)) || a.name.localeCompare(b.name));
  const opts = (exclude: string) => sorted.filter((a) => a.id !== exclude).map((a) => ({ value: a.id, label: isTradingAccountType(a.type) ? `${a.name} (trading)` : a.name }));
  const currency = f.currency || all.find((a) => a.id === f.from)?.currency || settings.defaultCurrency || 'AUD';
  const ok = f.from && f.to && f.from !== f.to && f.date && f.amount && D(f.amount).gt(0);

  const save = async () => {
    const res = await run(() => saveMove({ outId: existing?.outId, inId: existing?.inId, fromAccountId: f.from, toAccountId: f.to, date: f.date, amount: f.amount!, currency, note: f.note, timeZone: settings.taxTimeZone }), { success: existing ? 'Move saved.' : 'Money moved.' });
    if (res) onClose();
  };
  if (loading) return null;
  return (
    <>
      <Modal
        title={existing ? 'Edit money move' : 'Move money'}
        onClose={onClose}
        size="small"
        footer={
          <>
            {existing && (
              <button className="danger" style={{ marginRight: 'auto' }} onClick={() => setConfirmDel(true)}>
                Delete
              </button>
            )}
            <button onClick={onClose}>Cancel</button>
            <button className="primary" disabled={!ok} onClick={save}>
              {existing ? 'Save' : 'Move money'}
            </button>
          </>
        }
      >
        <p className="muted" style={{ marginTop: 0 }}>
          Between your own accounts — e.g. bank to bank, PayPal to bank, or bank to your broker. It isn’t income or an expense, so it doesn’t change your tax figures.
        </p>
        <div className="form-grid">
          <Select label="From" value={f.from} includeEmpty="Choose…" required onChange={(v) => setF({ ...f, from: v, to: f.to === v ? '' : f.to, currency: '' })} options={opts('')} className="span-2" />
          <Select label="To" value={f.to} includeEmpty="Choose…" required onChange={(v) => setF({ ...f, to: v })} options={opts(f.from)} className="span-2" />
          <TextInput label="Date" type="date" value={f.date} onChange={(v) => setF({ ...f, date: v })} required />
          <DecimalInput label="Amount" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} required />
          <TextInput label="Currency" value={currency} onChange={(v) => setF({ ...f, currency: v.toUpperCase() })} />
          <TextInput label="Note (optional)" value={f.note} onChange={(v) => setF({ ...f, note: v })} placeholder="e.g. savings" />
        </div>
      </Modal>
      {confirmDel && existing && (
        <Confirm
          title="Delete this move?"
          message="Both sides of the move are deleted. You can restore them from All transactions → Show deleted."
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirmDel(false)}
          onConfirm={async () => {
            setConfirmDel(false);
            const done = await run(() => deleteMove(existing), { success: 'Move deleted.' });
            if (done !== undefined) onClose();
          }}
        />
      )}
    </>
  );
}
