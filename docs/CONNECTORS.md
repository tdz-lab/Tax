# Adding a future connector

No connector is active in this build (`LIVE_CONNECTORS_ENABLED = false`). This guide describes how a future
provider integration should be added without weakening the guarantees of the import pipeline.

## 1. Confirm the provider actually supports it

Do **not** assume an API exists. Read the provider’s official developer documentation and confirm:

* the endpoints, authentication (OAuth 2.0, read-only API keys, Consumer Data Right accreditation, public address),
  scopes/permissions, rate limits and data retention terms;
* that **read-only** access is possible — never request trading, withdrawal or payment permissions;
* the statement/CSV alternative if no suitable API exists (the CSV importer already handles that case).

## 2. Implement the contract

Create `src/connectors/providers/<id>.ts` implementing `Connector` from `src/connectors/types.ts`:

```ts
export const exampleConnector: Connector = {
  info: { id: 'example', name: 'Example Exchange', category: 'crypto_exchange', status: 'planned', plannedAuth: ['api_key'], notes: '' },
  async authorise(scopes) { /* OAuth redirect or key capture; store secrets only in an encrypted store, never plain IndexedDB */ },
  async revoke() { /* revoke tokens at the provider and delete local secrets */ },
  async fetch(cursor, signal) { /* incremental fetch from cursor; respect rate limits; use backoffDelay() for retries */ },
  normalise(records) { /* map to Partial<Transaction>/RateRecord, keep raw values, set sourceId = provider record id */ }
};
```

Register it in `src/connectors/registry.ts` (and change its status only when it is complete and tested).

## 3. Reuse the import pipeline

A sync must never write records directly. Feed the normalised records through the same steps as a CSV import:

1. Build `PreparedRow`s (source id + occurrence fingerprint) — reuse `prepareRows` or construct equivalent rows.
2. Run duplicate detection against existing records (`loadDedupeMaps`).
3. Show the preview to the user and **require approval** before anything is written (`SyncJob.status = 'pending_approval'`).
4. Commit with `commitImport` (atomic, raw rows retained, audit event) so the batch can be rolled back.
5. Store the new cursor and `lastSyncAt` in the connector configuration (`connectors` table).

## 4. Errors, limits and revocation

* Use `backoffDelay(attempt, policy)` (exponential with jitter) and honour `Retry-After` headers.
* Log failures to the audit history; never leave a partial batch (the commit is atomic).
* Provide “Disconnect” which calls `revoke()` and removes stored secrets.

## 5. Test

* Unit-test `normalise()` with recorded provider responses (no live calls in tests).
* Test duplicate prevention across repeated syncs and against previously imported CSV statements of the same
  account (same `sourceId`).
* Test cursor handling, rate-limit back-off and revocation.
