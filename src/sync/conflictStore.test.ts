import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getPendingConflicts, setPendingConflicts } from './conflictStore';
import { getDb, getMeta } from '../storage/db';
import { createNote } from '../models/entry';
import { deriveKey } from '../crypto/crypto';

async function resetDb() {
  const db = await getDb();
  await db.clear('meta');
}

describe('pending conflicts', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('defaults to an empty array before any conflicts are stored', async () => {
    const { key } = await deriveKey('1234');
    expect(await getPendingConflicts(key)).toEqual([]);
  });

  it('persists and retrieves pending conflicts', async () => {
    const { key } = await deriveKey('1234');
    const local = createNote('local version', 'device-1');
    const remote = createNote('remote version', 'device-2');
    await setPendingConflicts(key, [{ local, remote }]);
    const loaded = await getPendingConflicts(key);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].local.text).toBe('local version');
    expect(loaded[0].remote.text).toBe('remote version');
  });

  it('stores pending conflicts encrypted at rest, not as plaintext entry text', async () => {
    const { key } = await deriveKey('1234');
    const local = createNote('do not leak this local text', 'device-1');
    const remote = createNote('do not leak this remote text', 'device-2');
    await setPendingConflicts(key, [{ local, remote }]);

    const raw = await getMeta('pendingConflicts');
    expect(raw).toBeDefined();
    expect(raw).not.toContain('do not leak this local text');
    expect(raw).not.toContain('do not leak this remote text');
    expect(raw).not.toContain('local version');
  });

  it('returns an empty array if decryption fails (e.g. wrong key)', async () => {
    const { key: writerKey } = await deriveKey('1234');
    const { key: wrongKey } = await deriveKey('9999');
    const local = createNote('local version', 'device-1');
    const remote = createNote('remote version', 'device-2');
    await setPendingConflicts(writerKey, [{ local, remote }]);

    expect(await getPendingConflicts(wrongKey)).toEqual([]);
  });
});
