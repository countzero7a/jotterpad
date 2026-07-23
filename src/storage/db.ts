import { openDB, DBSchema, IDBPDatabase } from 'idb';

interface JotterpadSchema extends DBSchema {
  entries: {
    key: string;
    value: { id: string; blob: string };
  };
  meta: {
    key: string;
    value: string;
  };
}

let dbPromise: Promise<IDBPDatabase<JotterpadSchema>> | null = null;

export function getDb(): Promise<IDBPDatabase<JotterpadSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<JotterpadSchema>('jotterpad', 1, {
      upgrade(db) {
        db.createObjectStore('entries', { keyPath: 'id' });
        db.createObjectStore('meta');
      },
    });
  }
  return dbPromise;
}

export async function getMeta(key: string): Promise<string | undefined> {
  const db = await getDb();
  return db.get('meta', key);
}

export async function setMeta(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.put('meta', value, key);
}

export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await getMeta('deviceId');
  if (existing) return existing;
  const id = crypto.randomUUID();
  await setMeta('deviceId', id);
  return id;
}

export async function getLastSyncAt(): Promise<number> {
  const raw = await getMeta('lastSyncAt');
  return raw ? Number(raw) : 0;
}

export async function setLastSyncAt(timestamp: number): Promise<void> {
  await setMeta('lastSyncAt', String(timestamp));
}
