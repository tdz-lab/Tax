/**
 * Future external-connector framework (NOT ACTIVE in this build).
 *
 * No connector in this build makes network requests, requests credentials or syncs data.
 * Each future connector must be implemented against the provider's actual, documented API
 * (authentication, scopes, rate limits) — nothing here assumes any provider offers an API.
 */
import type { Transaction, RateRecord } from '../domain/types';

export type ProviderCategory = 'bank' | 'accounting' | 'au_broker' | 'us_broker' | 'intl_broker' | 'crypto_exchange' | 'crypto_wallet' | 'futures' | 'forex_cfd' | 'prop_firm' | 'fx_rates';
export type AuthMethod = 'oauth2' | 'api_key' | 'read_only_address' | 'file_statement' | 'cdr' | 'none';

export interface ProviderInfo {
  id: string;
  name: string;
  category: ProviderCategory;
  /** Integration status in this build. Always 'planned' (no live connectors). */
  status: 'planned';
  plannedAuth: AuthMethod[];
  notes: string;
}

export interface ConnectionState {
  status: 'not_connected' | 'authorising' | 'connected' | 'error' | 'revoked';
  lastSyncAt?: string;
  lastError?: string;
  grantedScopes: string[];
}

export interface SyncCursor {
  /** Opaque provider cursor for incremental sync (e.g. last transaction id or timestamp). */
  value: string;
  updatedAt: string;
}

export interface FetchedRecord {
  providerRecordId: string;
  raw: unknown;
}

export interface NormalisedBatch {
  transactions: Partial<Transaction>[];
  rates?: Omit<RateRecord, 'id' | 'createdAt'>[];
  warnings: string[];
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

/** Contract every future connector implements. */
export interface Connector {
  info: ProviderInfo;
  /** Begin authorisation (OAuth redirect / API-key capture). Must never persist raw secrets in plain IndexedDB. */
  authorise(scopes: string[]): Promise<ConnectionState>;
  revoke(): Promise<ConnectionState>;
  /** Fetch records since cursor; must honour provider rate limits. */
  fetch(cursor: SyncCursor | null, signal: AbortSignal): Promise<{ records: FetchedRecord[]; next: SyncCursor | null }>;
  /** Map provider records into the canonical model, retaining raw values. */
  normalise(records: FetchedRecord[]): NormalisedBatch;
}

/** Exponential backoff with jitter used by the future sync scheduler. */
export function backoffDelay(attempt: number, p: RetryPolicy, rand: () => number = Math.random): number {
  const exp = Math.min(p.maxDelayMs, p.baseDelayMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp / 2 + (rand() * exp) / 2);
}

/**
 * Sync job orchestration (design). In a future build, a job will: fetch → normalise → run the
 * standard import duplicate detection → present a preview → require the user's approval →
 * commit via the same atomic import path used for CSV files.
 */
export interface SyncJob {
  id: string;
  providerId: string;
  startedAt: string;
  finishedAt?: string;
  status: 'pending_approval' | 'committed' | 'failed' | 'cancelled';
  fetched: number;
  proposedCreates: number;
  proposedSkips: number;
  error?: string;
}

export const LIVE_CONNECTORS_ENABLED = false;
