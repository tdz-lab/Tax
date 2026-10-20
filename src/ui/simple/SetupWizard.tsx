/**
 * "Quick questions" for a financial year — the plain-language front end of the tax profile. Every answer
 * is stored in the same TaxProfile record the advanced Tax profile tab edits.
 */
import { useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../../db/schema';
import type { TaxProfile } from '../../domain/types';
import { fyLabel, nowIso } from '../../lib/dates';
import { saveEntity } from '../../services/ledger';
import { useApp } from '../AppContext';
import { DecimalInput, Modal, TextInput } from '../components/ui';

function Choice<T extends string>({ value, onChange, options }: { value: T | undefined; onChange: (v: T) => void; options: { value: T; label: string; hint?: string }[] }) {
  return (
    <div className="row" style={{ gap: 6, marginTop: 4 }}>
      {options.map((o) => (
        <button key={o.value} type="button" className={value === o.value ? 'primary' : ''} aria-pressed={value === o.value} title={o.hint} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Q({ n, title, help, children }: { n: number; title: string; help?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ fontWeight: 600, fontSize: 14 }}>
        {n}. {title}
      </div>
      {help && <div className="muted" style={{ fontSize: 12 }}>{help}</div>}
      {children}
    </div>
  );
}

export function SetupWizard({ onClose }: { onClose: () => void }) {
  const { fy, run } = useApp();
  const stored = useLiveQuery(async () => (await getDb().taxProfiles.get(`tp_${fy}`)) ?? null, [fy]);
  const [tp, setTp] = useState<TaxProfile | null>(null);
  const [more, setMore] = useState(false);
  if (stored === undefined) return null;
  const cur: TaxProfile = tp ?? stored ?? { id: `tp_${fy}`, fy, residency: 'unknown', medicareExemption: 'none', privateHospitalCover: 'unknown', spouse: 'unknown', helpDebt: 'unknown', updatedAt: nowIso() };
  const set = (patch: Partial<TaxProfile>) => setTp({ ...cur, ...patch });
  const coverChoice = cur.privateHospitalCover === 'yes' ? (cur.daysWithoutCover ? 'part' : 'yes') : cur.privateHospitalCover;
  const save = async () => {
    const ok = await run(() => saveEntity('taxProfiles', { ...cur, updatedAt: nowIso() }), { success: `Answers for ${fyLabel(fy)} saved.` });
    if (ok !== undefined) onClose();
  };
  return (
    <Modal
      title={`Quick questions — ${fyLabel(fy)}`}
      onClose={onClose}
      footer={
        <>
          <span className="muted" style={{ marginRight: 'auto' }}>
            Not sure? Leave it — the app will remind you.
          </span>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save}>
            Save answers
          </button>
        </>
      }
    >
      <Q n={1} title="Were you an Australian resident for tax all year?" help="Most people who live and work in Australia are.">
        <Choice
          value={cur.residency}
          onChange={(v) => set({ residency: v })}
          options={[
            { value: 'resident', label: 'Yes, all year' },
            { value: 'part_year', label: 'Part of the year' },
            { value: 'non_resident', label: 'No — foreign resident' },
            { value: 'working_holiday', label: 'Working holiday visa (417/462)' }
          ]}
        />
        {cur.residency === 'part_year' && (
          <div style={{ maxWidth: 260, marginTop: 6 }}>
            <TextInput label="How many months were you a resident?" type="number" value={cur.residentMonths === undefined ? '' : String(cur.residentMonths)} onChange={(v) => set({ residentMonths: v === '' ? undefined : Math.max(1, Math.min(12, Math.floor(Number(v)))) })} hint="Count the months you arrived and left as whole months" />
          </div>
        )}
      </Q>
      <Q n={2} title="Did you have private hospital cover?" help="Hospital cover (not just extras). Without it, higher earners pay the Medicare levy surcharge.">
        <Choice
          value={coverChoice as 'yes' | 'no' | 'part' | 'unknown'}
          onChange={(v) => (v === 'part' ? set({ privateHospitalCover: 'yes', daysWithoutCover: cur.daysWithoutCover || 1 }) : set({ privateHospitalCover: v as 'yes' | 'no', daysWithoutCover: undefined }))}
          options={[
            { value: 'yes', label: 'Yes, all year' },
            { value: 'part', label: 'Part of the year' },
            { value: 'no', label: 'No' }
          ]}
        />
        {coverChoice === 'part' && (
          <div style={{ maxWidth: 260, marginTop: 6 }}>
            <TextInput label="Days without cover" type="number" value={String(cur.daysWithoutCover ?? '')} onChange={(v) => set({ daysWithoutCover: v === '' ? 1 : Math.max(1, Math.floor(Number(v))) })} />
          </div>
        )}
      </Q>
      <Q n={3} title="Did you have a spouse or partner on 30 June?" help="Married or de facto. Used for the Medicare family thresholds.">
        <Choice value={cur.spouse} onChange={(v) => set({ spouse: v })} options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]} />
        {cur.spouse === 'yes' && (
          <div className="form-grid" style={{ marginTop: 6 }}>
            <DecimalInput label="Their taxable income (approx.)" value={cur.spouseTaxableIncome} onChange={(v) => set({ spouseTaxableIncome: v })} />
            <DecimalInput label="Their income for MLS (if different)" value={cur.spouseMlsIncome} onChange={(v) => set({ spouseMlsIncome: v })} hint="Leave blank to use the same amount" />
          </div>
        )}
      </Q>
      <Q n={4} title="How many dependent children?" help="Without a partner, count only children you got family tax benefit for.">
        <div style={{ maxWidth: 140, marginTop: 4 }}>
          <TextInput label="Children" type="number" value={cur.dependants === undefined ? '0' : String(cur.dependants)} onChange={(v) => set({ dependants: v === '' ? 0 : Math.max(0, Math.floor(Number(v))) })} />
        </div>
      </Q>
      <Q n={5} title="Do you have a HELP or other study loan?">
        <Choice value={cur.helpDebt} onChange={(v) => set({ helpDebt: v })} options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]} />
        {cur.helpDebt === 'yes' && (
          <div style={{ maxWidth: 260, marginTop: 6 }}>
            <DecimalInput label="Loan balance (optional)" value={cur.helpBalance} onChange={(v) => set({ helpBalance: v })} hint="Your repayment can't be more than this" />
          </div>
        )}
      </Q>
      <Q n={6} title="Medicare levy exemption?" help="Rare — e.g. some visa holders or Defence Force members. If you don’t know, it’s “No”.">
        <Choice value={cur.medicareExemption} onChange={(v) => set({ medicareExemption: v })} options={[{ value: 'none', label: 'No' }, { value: 'half', label: 'Half' }, { value: 'full', label: 'Full' }]} />
      </Q>
      <div style={{ paddingTop: 10 }}>
        <button className="link" onClick={() => setMore(!more)}>
          {more ? '▾' : '▸'} Extra amounts from your income statement (optional)
        </button>
        {more && (
          <div className="form-grid" style={{ marginTop: 6 }}>
            <DecimalInput label="Reportable fringe benefits" value={cur.reportableFringeBenefits} onChange={(v) => set({ reportableFringeBenefits: v })} />
            <DecimalInput label="Reportable super contributions" value={cur.reportableSuperContributions} onChange={(v) => set({ reportableSuperContributions: v })} />
            <DecimalInput label="Net investment loss" value={cur.netInvestmentLoss} onChange={(v) => set({ netInvestmentLoss: v })} hint="e.g. negative gearing" />
            <DecimalInput label="PAYG instalments paid" value={cur.paygInstalments} onChange={(v) => set({ paygInstalments: v })} />
            <DecimalInput label="Tax losses from earlier years" value={cur.openingRevenueLosses} onChange={(v) => set({ openingRevenueLosses: v })} />
            <DecimalInput label="Capital losses from earlier years" value={cur.openingCapitalLosses} onChange={(v) => set({ openingCapitalLosses: v })} hint="Only if not already in the app" />
          </div>
        )}
      </div>
    </Modal>
  );
}
