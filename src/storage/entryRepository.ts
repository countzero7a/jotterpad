import { getDb } from './db';
import { encrypt, decrypt } from '../crypto/crypto';
import { Entry, markDeleted } from '../models/entry';

export async function saveEntry(key: CryptoKey, entry: Entry): Promise<void> {
  const db = await getDb();
  const blob = await encrypt(key, JSON.stringify(entry));
  await db.put('entries', { id: entry.id, blob });
}

export async function getAllEntries(key: CryptoKey): Promise<Entry[]> {
  const db = await getDb();
  const rows = await db.getAll('entries');
  return Promise.all(rows.map(async (row) => JSON.parse(await decrypt(key, row.blob)) as Entry));
}

export async function deleteEntry(key: CryptoKey, entries: Entry[], id: string): Promise<Entry[]> {
  const target = entries.find((e) => e.id === id);
  if (!target) return entries;
  const tombstoned = markDeleted(target);
  await saveEntry(key, tombstoned);
  return entries.map((e) => (e.id === id ? tombstoned : e));
}
