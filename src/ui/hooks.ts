import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../db/schema';
import type { Account, Category, Instrument } from '../domain/types';
import type { TaxYearResult } from '../engines/tax/taxEngine';
import type { QualityIssue } from '../engines/reconciliation/quality';
import { computeYear, getWorkspace, qualityIssues, type Workspace } from '../services/calc';
import { useApp } from './AppContext';

export function useAccounts(): Account[] {
  return useLiveQuery(() => getDb().accounts.toArray(), [], []) ?? [];
}
export function useInstruments(): Instrument[] {
  return useLiveQuery(() => getDb().instruments.toArray(), [], []) ?? [];
}
export function useCategories(): Category[] {
  return useLiveQuery(() => getDb().categories.toArray(), [], []) ?? [];
}

/** Recompute derived results when the data revision changes. */
function useDerived<T>(fn: () => Promise<T>, deps: unknown[]): { value: T | null; loading: boolean; error: string | null } {
  const { revision } = useApp();
  const [state, setState] = useState<{ value: T | null; loading: boolean; error: string | null }>({ value: null, loading: true, error: null });
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    fn()
      .then((value) => alive && setState({ value, loading: false, error: null }))
      .catch((e) => alive && setState({ value: null, loading: false, error: (e as Error).message }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, ...deps]);
  return state;
}

export function useTaxYear(fy: number) {
  return useDerived<TaxYearResult>(() => computeYear(fy), [fy]);
}
export function useQuality(fy?: number) {
  return useDerived<QualityIssue[]>(() => qualityIssues(fy), [fy]);
}
export function useWorkspace() {
  return useDerived<Workspace>(() => getWorkspace(), []);
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
