import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Dexie from 'dexie';
import { AppDB, setDb } from '../../src/db/schema';
import { ensureSeeded } from '../../src/services/bootstrap';
import { invalidateRateCache } from '../../src/services/ledger';
import { invalidateCalcCache } from '../../src/services/calc';

let n = 0;
export async function freshDb(): Promise<AppDB> {
  const db = new AppDB(`test-db-${Date.now()}-${n++}`);
  setDb(db);
  invalidateRateCache();
  invalidateCalcCache();
  await db.open();
  await ensureSeeded();
  return db;
}

export async function dropDb(db: AppDB): Promise<void> {
  db.close();
  await Dexie.delete(db.name);
}

export const sample = (file: string) => readFileSync(resolve(__dirname, '../../public/samples', file), 'utf8');
