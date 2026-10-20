import type { AppSettings } from '../domain/types';
import { DEFAULT_METHODOLOGY } from '../engines/currency/rates';
import { DEFAULT_TAX_TZ } from '../lib/dates';
import { getDb } from '../db/schema';

export const APP_VERSION = '1.1.0';

export const DEFAULT_SETTINGS: AppSettings = {
  taxTimeZone: DEFAULT_TAX_TZ,
  dateFormat: 'dd/MM/yyyy',
  timeFormat: '12h',
  displayCurrency: 'AUD',
  displayDecimals: 2,
  defaultCurrency: 'AUD',
  selectedFY: null,
  rateMethodology: DEFAULT_METHODOLOGY,
  costBasisDefaults: { au_share: 'FIFO', us_share: 'FIFO', intl_share: 'FIFO', etf: 'FIFO', crypto: 'FIFO', stablecoin: 'FIFO', option: 'FIFO' },
  lossOrdering: 'non_discount_first',
  theme: 'system',
  backupReminderDays: 14,
  pageSize: 50,
  includeDocumentsInBackup: true,
  onboarded: false
};

export async function loadSettings(): Promise<AppSettings> {
  const row = await getDb().settings.get('app');
  return mergeSettings(row?.value as Partial<AppSettings> | undefined);
}

export function mergeSettings(v: Partial<AppSettings> | undefined): AppSettings {
  return { ...DEFAULT_SETTINGS, ...(v ?? {}), rateMethodology: { ...DEFAULT_METHODOLOGY, ...(v?.rateMethodology ?? {}) }, costBasisDefaults: { ...DEFAULT_SETTINGS.costBasisDefaults, ...(v?.costBasisDefaults ?? {}) } };
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const db = getDb();
  return db.transaction('rw', db.settings, async () => {
    const cur = await loadSettings();
    const next = mergeSettings({ ...cur, ...patch });
    await db.settings.put({ key: 'app', value: next });
    return next;
  });
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await getDb().settings.get(key);
  return (row?.value as T) ?? fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await getDb().settings.put({ key, value });
}
