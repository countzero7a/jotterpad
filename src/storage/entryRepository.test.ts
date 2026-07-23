// src/storage/entryRepository.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { saveEntry, getAllEntries, deleteEntry } from './entryRepository';
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

  it('marks an entry as deleted via deleteEntry', async () => {
    const { key } = await deriveKey('1234');
    const entry = createNote('temporary note', 'device-1');
    await saveEntry(key, entry);
    const loaded = await getAllEntries(key);

    const updated = await deleteEntry(key, loaded, entry.id);
    expect(updated.find((e) => e.id === entry.id)?.deleted).toBe(true);

    const persisted = await getAllEntries(key);
    expect(persisted.find((e) => e.id === entry.id)?.deleted).toBe(true);
  });

  it('leaves the entry list unchanged when deleting an unknown id', async () => {
    const { key } = await deriveKey('1234');
    const entry = createNote('stays put', 'device-1');
    await saveEntry(key, entry);
    const loaded = await getAllEntries(key);

    const updated = await deleteEntry(key, loaded, 'does-not-exist');
    expect(updated).toEqual(loaded);
  });
});
