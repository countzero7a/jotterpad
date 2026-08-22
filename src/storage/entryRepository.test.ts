// src/storage/entryRepository.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { saveEntry, getAllEntries } from './entryRepository';
import { createNote } from '../models/entry';
import { deriveKey } from '../crypto/crypto';
import { getDb } from './db';

async function resetDb() {
  const db = await getDb();
  await db.clear('entries');
  await db.clear('meta');
}

describe('entryRepository', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('saves and retrieves an entry, encrypted at rest', async () => {
    const { key } = await deriveKey('1234');
    const entry = createNote('buy milk', 'device-1');
    await saveEntry(key, entry);

    const db = await getDb();
    const raw = await db.get('entries', entry.id);
    expect(raw?.blob).not.toContain('buy milk');

    const all = await getAllEntries(key);
    expect(all).toHaveLength(1);
    expect(all[0].text).toBe('buy milk');
  });
});
