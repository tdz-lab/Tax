import type { Tour } from '../types';
import { dashboardTour, gettingStarted } from './basics';
import { transactionsTour } from './transactions';
import { assetsTour, businessTour, expensesTour, incomeTour, logsTour, taxProfileTour } from './taxBusiness';
import { corporateActionsTour, cryptoTour, derivativesTour, instrumentsTour, lotsTour, performanceTour, propTour, recordSharesTour, tradingAccountsTour, tradingOverviewTour } from './trading';
import { currencyBasicsTour, marketsTimeTour, ratesImportTour, ratesManualTour } from './currency';
import { backupTour, documentsTour, importsTour, reconciliationTour, reportsTour, settingsTour, taxCalcTour } from './workflow';

export interface TourGroup {
  title: string;
  route: string;
  tours: Tour[];
}

export const TOUR_GROUPS: TourGroup[] = [
  { title: 'Start here', route: '/', tours: [gettingStarted, dashboardTour] },
  { title: 'Tax & Business', route: '/tax', tours: [taxProfileTour, incomeTour, expensesTour, businessTour, assetsTour, logsTour] },
  { title: 'Trading & Investments', route: '/trading', tours: [tradingOverviewTour, tradingAccountsTour, instrumentsTour, recordSharesTour, cryptoTour, derivativesTour, lotsTour, performanceTour, propTour, corporateActionsTour] },
  { title: 'Currencies, exchange rates & markets', route: '/settings?tab=rates', tours: [currencyBasicsTour, ratesImportTour, ratesManualTour, marketsTimeTour] },
  { title: 'Transactions', route: '/transactions', tours: [transactionsTour] },
  { title: 'Imports', route: '/imports', tours: [importsTour] },
  { title: 'Documents & Receipts', route: '/documents', tours: [documentsTour] },
  { title: 'Tax Calculations', route: '/tax-calc', tours: [taxCalcTour] },
  { title: 'Reports & PDF Export', route: '/reports', tours: [reportsTour] },
  { title: 'Reconciliation', route: '/reconciliation', tours: [reconciliationTour] },
  { title: 'Settings & Data', route: '/settings', tours: [settingsTour, backupTour] }
];

export const TOURS: Tour[] = TOUR_GROUPS.flatMap((g) => g.tours);

/** Recommended order for the complete course. */
export const COURSE: string[] = [
  'getting-started', 'tax-profile', 'trading-overview', 'trading-accounts', 'trading-instruments', 'currency-basics', 'currency-markets', 'currency-import',
  'currency-manual', 'imports', 'transactions', 'income', 'expenses', 'business', 'assets', 'logs', 'trading-shares', 'trading-crypto', 'trading-derivatives',
  'trading-lots', 'trading-corporate', 'trading-prop', 'trading-performance', 'documents', 'reconciliation', 'dashboard', 'tax-calc', 'reports', 'settings', 'backup'
];

export function tourById(id: string): Tour | undefined {
  return TOURS.find((t) => t.id === id);
}

/** Tours relevant to the current route (section). */
export function toursForRoute(path: string): Tour[] {
  const base = '/' + (path.replace(/^#?\//, '').split(/[/?]/)[0] ?? '');
  const own = TOURS.filter((t) => t.section === base || (base === '/' && t.section === '/'));
  if (base === '/settings') return [...own, ...TOURS.filter((t) => t.id.startsWith('currency'))].filter((t, i, a) => a.indexOf(t) === i);
  return own;
}
