/** Local document store: files are kept in IndexedDB with a SHA-256 hash; metadata extraction is basic and local. */
import { getDb } from '../db/schema';
import { newId, sha256Hex } from '../lib/ids';
import { fyOfLocalDate, nowIso } from '../lib/dates';
import { readFileBuffer } from '../lib/files';
import type { DocumentMeta } from '../domain/types';
import { bumpRevision, writeAudit } from './ledger';

export const MAX_DOC_BYTES = 15 * 1024 * 1024;
export const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'text/csv', 'application/vnd.ms-excel', 'text/plain'];

/** Extract simple, verifiable metadata. No OCR is performed. */
export function extractMetadata(name: string, mime: string, buf: ArrayBuffer): Record<string, string> {
  const out: Record<string, string> = {};
  const bytes = new Uint8Array(buf);
  if (mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) {
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 4_000_000)));
    const pages = head.match(/\/Type\s*\/Page(?!s)/g)?.length;
    if (pages) out.pages = String(pages);
    const title = /\/Title\s*\(([^)]{1,200})\)/.exec(head)?.[1];
    if (title) out.title = title;
    const created = /\/CreationDate\s*\(D:(\d{8})/.exec(head)?.[1];
    if (created) out.createdDate = `${created.slice(0, 4)}-${created.slice(4, 6)}-${created.slice(6, 8)}`;
  } else if (mime.startsWith('text/') || name.toLowerCase().endsWith('.csv')) {
    const text = new TextDecoder().decode(bytes.subarray(0, 200_000));
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    out.lines = String(lines.length);
    if (lines[0]) out.header = lines[0].slice(0, 300);
  } else if (mime === 'image/png' && bytes.length > 24) {
    const dv = new DataView(buf);
    out.dimensions = `${dv.getUint32(16)}×${dv.getUint32(20)}`;
  } else if (mime === 'image/jpeg') {
    for (let i = 2; i < bytes.length - 9; ) {
      if (bytes[i] !== 0xff) break;
      const marker = bytes[i + 1];
      const len = (bytes[i + 2] << 8) + bytes[i + 3];
      if (marker >= 0xc0 && marker <= 0xc3) {
        out.dimensions = `${(bytes[i + 7] << 8) + bytes[i + 8]}×${(bytes[i + 5] << 8) + bytes[i + 6]}`;
        break;
      }
      i += 2 + len;
    }
  }
  const dateInName = /(20\d{2})[-_]?(\d{2})[-_]?(\d{2})/.exec(name);
  if (dateInName) out.dateFromFilename = `${dateInName[1]}-${dateInName[2]}-${dateInName[3]}`;
  return out;
}

export async function addDocument(file: File, meta: Partial<DocumentMeta> = {}): Promise<DocumentMeta> {
  if (file.size > MAX_DOC_BYTES) throw new Error(`File is larger than ${MAX_DOC_BYTES / 1024 / 1024} MB.`);
  const buf = await readFileBuffer(file);
  const sha = await sha256Hex(buf);
  const db = getDb();
  const dup = await db.documents.where('sha256').equals(sha).first();
  if (dup) throw new Error(`This file is already stored as “${dup.title}”.`);
  const mime = file.type || (file.name.endsWith('.csv') ? 'text/csv' : 'application/octet-stream');
  const extracted = extractMetadata(file.name, mime, buf);
  const date = meta.date ?? extracted.dateFromFilename ?? extracted.createdDate;
  const doc: DocumentMeta = {
    id: newId('doc'),
    title: meta.title || file.name.replace(/\.[^.]+$/, ''),
    docType: meta.docType ?? 'other',
    date,
    fy: date ? fyOfLocalDate(date) : meta.fy,
    linkedRecordIds: meta.linkedRecordIds ?? [],
    notes: meta.notes,
    originalFilename: file.name,
    mimeType: mime,
    size: file.size,
    sha256: sha,
    importedAt: nowIso(),
    storageStatus: 'stored',
    extracted
  };
  await db.transaction('rw', [db.documents, db.docBlobs, db.transactions, db.audit, db.meta], async () => {
    await db.documents.add(doc);
    await db.docBlobs.add({ id: doc.id, data: buf });
    for (const rid of doc.linkedRecordIds) {
      const t = await db.transactions.get(rid);
      if (t && !t.documentIds.includes(doc.id)) await db.transactions.put({ ...t, documentIds: [...t.documentIds, doc.id], updatedAt: nowIso(), version: t.version + 1 });
    }
    await writeAudit({ entityType: 'document', entityId: doc.id, action: 'create', summary: `Document added: ${doc.title} (${file.name}, sha256 ${sha.slice(0, 12)}…)` });
    await bumpRevision();
  });
  return doc;
}

export async function linkDocument(docId: string, recordId: string, link = true): Promise<void> {
  const db = getDb();
  await db.transaction('rw', [db.documents, db.transactions, db.audit, db.meta], async () => {
    const doc = await db.documents.get(docId);
    if (!doc) throw new Error('Document not found');
    const ids = new Set(doc.linkedRecordIds);
    if (link) ids.add(recordId);
    else ids.delete(recordId);
    await db.documents.put({ ...doc, linkedRecordIds: [...ids] });
    const t = await db.transactions.get(recordId);
    if (t) {
      const d = new Set(t.documentIds);
      if (link) d.add(docId);
      else d.delete(docId);
      await db.transactions.put({ ...t, documentIds: [...d], updatedAt: nowIso(), version: t.version + 1 });
    }
    await writeAudit({ entityType: 'document', entityId: docId, action: 'update', summary: `${link ? 'Linked' : 'Unlinked'} document ${doc.title} ${link ? 'to' : 'from'} ${recordId}` });
    await bumpRevision();
  });
}

export async function updateDocumentMeta(doc: DocumentMeta): Promise<void> {
  const db = getDb();
  await db.documents.put({ ...doc, fy: doc.date ? fyOfLocalDate(doc.date) : doc.fy });
  await writeAudit({ entityType: 'document', entityId: doc.id, action: 'update', summary: `Document details updated: ${doc.title}` });
  await bumpRevision();
}

export async function deleteDocument(docId: string): Promise<void> {
  const db = getDb();
  await db.transaction('rw', [db.documents, db.docBlobs, db.transactions, db.audit, db.meta], async () => {
    const doc = await db.documents.get(docId);
    if (!doc) return;
    for (const rid of doc.linkedRecordIds) {
      const t = await db.transactions.get(rid);
      if (t) await db.transactions.put({ ...t, documentIds: t.documentIds.filter((x) => x !== docId), updatedAt: nowIso(), version: t.version + 1 });
    }
    await db.documents.delete(docId);
    await db.docBlobs.delete(docId);
    await writeAudit({ entityType: 'document', entityId: docId, action: 'delete', summary: `Document deleted: ${doc.title}` });
    await bumpRevision();
  });
}

export async function openDocument(docId: string): Promise<string | null> {
  const db = getDb();
  const [doc, blob] = await Promise.all([db.documents.get(docId), db.docBlobs.get(docId)]);
  if (!doc || !blob) return null;
  return URL.createObjectURL(new Blob([blob.data], { type: doc.mimeType }));
}

/** Verify stored files still match their recorded hashes. */
export async function verifyDocuments(): Promise<{ ok: number; missing: string[]; mismatched: string[] }> {
  const db = getDb();
  const docs = await db.documents.toArray();
  const res = { ok: 0, missing: [] as string[], mismatched: [] as string[] };
  for (const d of docs) {
    const b = await db.docBlobs.get(d.id);
    if (!b) {
      res.missing.push(d.id);
      continue;
    }
    if ((await sha256Hex(b.data)) !== d.sha256) res.mismatched.push(d.id);
    else res.ok++;
  }
  return res;
}
