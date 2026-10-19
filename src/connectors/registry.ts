import type { ProviderInfo } from './types';

/** Planned providers. Listing a provider here does NOT imply it offers an API or that one exists. */
export const PROVIDERS: ProviderInfo[] = [
  { id: 'au_bank_cdr', name: 'Australian banks (Consumer Data Right)', category: 'bank', status: 'planned', plannedAuth: ['cdr'], notes: 'Would require accreditation or an accredited intermediary under the CDR regime.' },
  { id: 'accounting_platform', name: 'Accounting software exports', category: 'accounting', status: 'planned', plannedAuth: ['oauth2', 'file_statement'], notes: 'CSV exports are supported today via Imports.' },
  { id: 'au_broker', name: 'Australian share brokers', category: 'au_broker', status: 'planned', plannedAuth: ['file_statement'], notes: 'Most retail brokers provide statements/CSV; API availability varies by broker.' },
  { id: 'us_broker', name: 'US share brokers', category: 'us_broker', status: 'planned', plannedAuth: ['oauth2', 'file_statement'], notes: 'Implement per broker against its documented API, if any.' },
  { id: 'intl_broker', name: 'International multi-market brokers', category: 'intl_broker', status: 'planned', plannedAuth: ['file_statement'], notes: 'Activity statements / flex-style reports via CSV import today.' },
  { id: 'crypto_exchange', name: 'Crypto exchanges', category: 'crypto_exchange', status: 'planned', plannedAuth: ['api_key', 'file_statement'], notes: 'Read-only keys only; never trading or withdrawal permissions.' },
  { id: 'crypto_wallet', name: 'Self-custody wallets (public address)', category: 'crypto_wallet', status: 'planned', plannedAuth: ['read_only_address'], notes: 'Would use a chain indexer — no private keys or seed phrases ever.' },
  { id: 'futures_broker', name: 'Futures brokers', category: 'futures', status: 'planned', plannedAuth: ['file_statement'], notes: 'Daily statements import via CSV today.' },
  { id: 'forex_cfd', name: 'Forex & CFD brokers', category: 'forex_cfd', status: 'planned', plannedAuth: ['file_statement'], notes: 'Account statements via CSV today.' },
  { id: 'prop_firm', name: 'Prop-firm reporting', category: 'prop_firm', status: 'planned', plannedAuth: ['file_statement'], notes: 'Payout statements via CSV today.' },
  { id: 'fx_rba', name: 'Historical exchange rates (e.g. RBA published tables)', category: 'fx_rates', status: 'planned', plannedAuth: ['file_statement'], notes: 'Download published rate tables and import them (wide or long CSV) today; no automatic download in this build.' }
];
