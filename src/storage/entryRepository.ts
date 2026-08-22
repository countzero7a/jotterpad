import { getDb } from './db';
import { encrypt, decrypt } from '../crypto/crypto';
import { Entry } from '../models/entry';

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
