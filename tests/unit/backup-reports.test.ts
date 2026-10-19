import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppDB } from '../../src/db/schema';
import { exportBackup, readBackup, restoreBackup, buildBackup } from '../../src/backup/backup';
import { encryptText, decryptText } from '../../src/backup/crypto';
import { loadDemoData, removeDemoData } from '../../src/services/demo';
import { addDocument, linkDocument, verifyDocuments } from '../../src/services/documents';
import { computeYear, qualityIssues, saveCalculationRun } from '../../src/services/calc';
import { generatePdfReport, generateCsvExport } from '../../src/reports/generate';
import { gatherReportContext } from '../../src/reports/reportData';
import { saveTransaction } from '../../src/services/ledger';
import { suggestTransferMatches } from '../../src/engines/reconciliation/quality';
import { dropDb, freshDb, sample } from './dbHelpers';
import { readFileBuffer, readFileText } from '../../src/lib/files';

let db: AppDB;
beforeEach(async () => {
  db = await freshDb();
});
afterEach(async () => dropDb(db));

const fetcher = async (f: string) => sample(f);
const fileOf = (name: string, text: string, type: string) => new File([text], name, { type });

describe('demonstration data end-to-end', () => {
  it('loads fictional demo data through the import pipeline and computes FY2024–25', async () => {
    const res = await loadDemoData(fetcher);
    expect(res.records).toBeGreaterThan(30);
    const all = await db.transactions.toArray();
    expect(all.every((t) => t.isDemo && t.description.startsWith('[DEMO]'))).toBe(true);
    // All USD records got a (fictional, DEMO-labelled) historical rate.
    const usd = all.filter((t) => t.currency === 'USD');
    expect(usd.length).toBeGreaterThan(5);
    expect(usd.filter((t) => !t.fx).map((t) => t.description)).toEqual([]);
    const r = await computeYear(2025);
    // Shares: 250 DEMOA sold 20 Aug 2024 @ 31.50 − 19.95 = 7,855.05; FIFO: 200 @ (5,000+19.95) + 50/100 × 2,819.95
    const demoa = r.disposals.find((d) => d.allocations.length === 2)!;
    expect(demoa.proceedsAud).toBe('7855.05');
    expect(demoa.costAud).toBe('6429.925');
    expect(demoa.allocations[0].discountEligible).toBe(true); // bought 10 May 2023
    expect(demoa.allocations[1].discountEligible).toBe(false); // bought 15 Feb 2024
    expect(r.readiness.status).not.toBe('ready_for_agent_review'); // demo deliberately contains review items
    expect(r.reviewItems.length).toBeGreaterThan(0);
    const q = await qualityIssues(2025);
    expect(q.some((i) => i.code === 'ACCOUNT_TREATMENT')).toBe(true);
    expect(q.some((i) => i.code === 'MISSING_EVIDENCE')).toBe(true);
    // Removing demo data leaves nothing behind.
    await removeDemoData();
    expect(await db.transactions.count()).toBe(0);
    expect(await db.accounts.count()).toBe(0);
    expect(await db.rates.count()).toBe(0);
  });

  it('generates both PDF reports and CSV exports with snapshots', async () => {
    await loadDemoData(fetcher);
    const opts = { fy: 2025, accountIds: null, markets: null, schedules: { conversionLedger: true, documentIndex: true, auditHistory: true, lotDetail: true } };
    const basic = await generatePdfReport({ ...opts, type: 'basic' });
    const full = await generatePdfReport({ ...opts, type: 'full' });
    const head = async (b: Blob) => new TextDecoder().decode(new Uint8Array(await readFileBuffer(b)).subarray(0, 8));
    expect(await head(basic.blob)).toMatch(/^%PDF-1\./);
    expect(await head(full.blob)).toMatch(/^%PDF-1\./);
    expect(full.blob.size).toBeGreaterThan(basic.blob.size);
    const fullText = new TextDecoder('latin1').decode(new Uint8Array(await readFileBuffer(full.blob)));
    const pages = fullText.match(/\/Type \/Page[^s]/g)?.length ?? 0;
    expect(pages).toBeGreaterThan(5);
    expect(await db.reports.count()).toBe(2);
    expect(await db.calcRuns.count()).toBe(2);
    const runs = await db.calcRuns.toArray();
    expect(runs.some((r) => r.supersedesId)).toBe(true);
    const csv = await generateCsvExport({ ...opts, type: 'full' }, 'ledger');
    const text = await readFileText(csv.blob);
    expect(text.split('\n')[0]).toContain('amount_aud');
    const ctx = await gatherReportContext({ ...opts, type: 'full' }, 'test');
    expect(ctx.txns.every((t) => t.fy === 2025)).toBe(true);
    expect(ctx.closingLots.length).toBeGreaterThan(0);
  });

  it('every tax total is traceable to source records', async () => {
    await loadDemoData(fetcher);
    const r = await computeYear(2025);
    const ids = new Set((await db.transactions.toArray()).map((t) => t.id));
    for (const l of [...r.income, ...r.deductions, ...r.business, ...r.capitalLines, ...r.revenueTrading, ...r.foreign]) {
      for (const s of l.sourceIds) expect(ids.has(s) || s.startsWith('ast_') || l.key === 'bus_depreciation').toBe(true);
    }
    const nonEmpty = [...r.income, ...r.capitalLines].filter((l) => l.amount && l.amount !== '0');
    expect(nonEmpty.every((l) => l.sourceIds.length > 0 || ['cgt_prior', 'cgt_discount', 'cgt_cf'].includes(l.key))).toBe(true);
  });
});

describe('backup and restore', () => {
  it('round-trips all records, documents and relationships (replace mode)', async () => {
    await loadDemoData(fetcher);
    const t = await saveTransaction({ kind: 'expense', date: '2024-08-01', description: 'Receipt test', category: 'software', amount: '10', currency: 'AUD' });
    const doc = await addDocument(fileOf('receipt-2024-08-01.csv', 'a,b\n1,2\n', 'text/csv'), { title: 'Receipt', docType: 'receipt' });
    await linkDocument(doc.id, t.id);
    const before = { txns: await db.transactions.count(), docs: await db.documents.count(), rates: await db.rates.count(), audit: await db.audit.count() };
    const { blob, manifest } = await exportBackup({ includeDocuments: true });
    expect(manifest.counts.transactions).toBe(before.txns);
    const text = await readFileText(blob);
    // wipe and restore
    await db.transactions.clear();
    await db.documents.clear();
    await db.docBlobs.clear();
    const payload = await readBackup(text);
    const rep = await restoreBackup(payload, 'replace');
    expect(rep.documentsRestored).toBe(1);
    expect(await db.transactions.count()).toBe(before.txns);
    expect(await db.rates.count()).toBe(before.rates);
    const restored = await db.transactions.get(t.id);
    expect(restored!.documentIds).toEqual([doc.id]);
    expect((await db.documents.get(doc.id))!.linkedRecordIds).toEqual([t.id]);
    expect(await verifyDocuments()).toMatchObject({ ok: 1, missing: [], mismatched: [] });
    // Calculations reproduce after restore
    const r = await computeYear(2025);
    expect(r.disposals.length).toBeGreaterThan(0);
  });
  it('detects tampering via integrity hashes', async () => {
    await saveTransaction({ kind: 'income', date: '2024-08-01', description: 'Salary', category: 'salary', amount: '100', currency: 'AUD' });
    const payload = await buildBackup({ includeDocuments: false });
    const tampered = JSON.parse(JSON.stringify(payload));
    tampered.tables.transactions[0].amount = '999999';
    await expect(readBackup(JSON.stringify(tampered))).rejects.toThrow(/integrity/);
  });
  it('refuses backups from a newer schema', async () => {
    const payload = await buildBackup({ includeDocuments: false });
    await expect(readBackup(JSON.stringify({ ...payload, schemaVersion: 99 }))).rejects.toThrow(/newer/);
  });
  it('merge mode adds missing records and reports conflicts without overwriting', async () => {
    const a = await saveTransaction({ kind: 'income', date: '2024-08-01', description: 'A', category: 'other', amount: '1', currency: 'AUD' });
    const payload = await buildBackup({ includeDocuments: false });
    await saveTransaction({ ...a, description: 'A changed' });
    await db.transactions.add({ ...a, id: 'extra', description: 'local only' });
    const rep = await restoreBackup(payload, 'merge');
    expect(rep.conflicts.transactions).toBe(1);
    expect((await db.transactions.get(a.id))!.description).toBe('A changed');
    expect(await db.transactions.get('extra')).toBeTruthy();
  });
  it('encrypted backups use authenticated encryption (wrong password / tamper fails)', async () => {
    const env = await encryptText('secret payload', 'correct horse battery', 1000);
    expect(env.ciphertext).not.toContain('secret');
    expect(await decryptText(env, 'correct horse battery')).toBe('secret payload');
    await expect(decryptText(env, 'wrong password!')).rejects.toThrow(/password/);
    const bad = { ...env, ciphertext: env.ciphertext.slice(0, -4) + 'AAAA' };
    await expect(decryptText(bad, 'correct horse battery')).rejects.toThrow();
    await expect(encryptText('x', 'short')).rejects.toThrow(/8 characters/);
  });
  it('full encrypted backup export → restore', async () => {
    await saveTransaction({ kind: 'income', date: '2024-08-01', description: 'Enc', category: 'other', amount: '5', currency: 'AUD' });
    const { blob, manifest } = await exportBackup({ includeDocuments: false, password: 'a long password' });
    expect(manifest.encrypted).toBe(true);
    const text = await readFileText(blob);
    await expect(readBackup(text)).rejects.toThrow(/encrypted/);
    const payload = await readBackup(text, 'a long password');
    await db.transactions.clear();
    await restoreBackup(payload, 'replace');
    expect(await db.transactions.count()).toBe(1);
  }, 60000);
});

describe('documents and transfer matching', () => {
  it('stores documents with SHA-256 and rejects duplicates', async () => {
    const d = await addDocument(fileOf('stmt.csv', 'Date,Amount\n2024-01-01,5\n', 'text/csv'));
    expect(d.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(d.extracted!.lines).toBe('2');
    await expect(addDocument(fileOf('copy.csv', 'Date,Amount\n2024-01-01,5\n', 'text/csv'))).rejects.toThrow(/already stored/);
  });
  it('suggests own-wallet transfer pairs', () => {
    const base = { status: 'active', kind: 'trade', instrumentId: 'BTC', documentIds: [], relatedIds: [], tags: [], reviewFlags: [] } as any;
    const s = suggestTransferMatches([
      { ...base, id: 's', side: 'send', accountId: 'X', quantity: '1', feeQuantity: '0.0005', occurredAt: '2024-01-01T00:00:00Z' },
      { ...base, id: 'r', side: 'receive', accountId: 'W', quantity: '0.9995', occurredAt: '2024-01-01T00:30:00Z' },
      { ...base, id: 'r2', side: 'receive', accountId: 'W', quantity: '5', occurredAt: '2024-01-01T00:30:00Z' }
    ]);
    expect(s).toEqual([expect.objectContaining({ sendId: 's', receiveId: 'r', confidence: 'high' })]);
  });
  it('stores calculation snapshots immutably with a reason', async () => {
    await saveTransaction({ kind: 'income', date: '2024-08-01', description: 'S', category: 'salary', amount: '100', currency: 'AUD' });
    const r1 = await saveCalculationRun(2025, 'first');
    await saveTransaction({ kind: 'income', date: '2024-08-02', description: 'S2', category: 'salary', amount: '50', currency: 'AUD' });
    const r2 = await saveCalculationRun(2025, 'after new income');
    expect(r2.supersedesId).toBe(r1.id);
    expect(r1.inputHash).not.toBe(r2.inputHash);
    expect((await db.calcRuns.get(r1.id))!.summary.assessableIncome).toBe('100');
  });
});
