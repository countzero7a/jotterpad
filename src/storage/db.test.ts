import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  getDb,
  getLastSentAt,
  setLastSentAt,
  getLastSyncAt,
  setLastSyncAt,
  getPendingConflicts,
  setPendingConflicts,
} from './db';
import { createNote } from '../models/entry';

async function resetDb() {
  const db = await getDb();
  await db.clear('meta');
}

describe('db watermarks', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('defaults lastSentAt to 0 before it is ever set', async () => {
    expect(await getLastSentAt()).toBe(0);
  });

  it('persists and retrieves lastSentAt', async () => {
    await setLastSentAt(12345);
    expect(await getLastSentAt()).toBe(12345);
  });

  it('keeps lastSentAt independent from lastSyncAt', async () => {
    await setLastSyncAt(1000);
    await setLastSentAt(2000);
    expect(await getLastSyncAt()).toBe(1000);
    expect(await getLastSentAt()).toBe(2000);
  });
});

describe('pending conflicts', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('defaults to an empty array before any conflicts are stored', async () => {
    expect(await getPendingConflicts()).toEqual([]);
  });

  it('persists and retrieves pending conflicts', async () => {
    const local = createNote('local version', 'device-1');
    const remote = createNote('remote version', 'device-2');
    await setPendingConflicts([{ local, remote }]);
    const loaded = await getPendingConflicts();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].local.text).toBe('local version');
    expect(loaded[0].remote.text).toBe('remote version');
  });
});
