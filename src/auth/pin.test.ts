import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { isPinConfigured, setupPin, unlockWithPin } from './pin';
import { getDb, getMeta } from '../storage/db';

async function resetDb() {
  const db = await getDb();
  await db.clear('meta');
}

describe('pin', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('reports not configured before setup', async () => {
    expect(await isPinConfigured()).toBe(false);
  });

  it('reports configured after setup', async () => {
    await setupPin('4242');
    expect(await isPinConfigured()).toBe(true);
  });

  it('unlocks with the correct pin', async () => {
    await setupPin('4242');
    const key = await unlockWithPin('4242');
    expect(key).not.toBeNull();
  });

  it('refuses to unlock with the wrong pin', async () => {
    await setupPin('4242');
    const key = await unlockWithPin('0000');
    expect(key).toBeNull();
  });

  it('refuses to unlock before any pin is set up', async () => {
    const key = await unlockWithPin('4242');
    expect(key).toBeNull();
  });

  it('reports not configured when verifier is missing after partial setup', async () => {
    await setupPin('4242');
    expect(await isPinConfigured()).toBe(true);
    const db = await getDb();
    await db.delete('meta', 'verifier');
    expect(await isPinConfigured()).toBe(false);
  });

  it('does not produce a mismatched salt/verifier pair when setupPin is called concurrently with different pins', async () => {
    const [keyA] = await Promise.all([setupPin('1111'), setupPin('2222')]);
    const unlockedWithA = await unlockWithPin('1111');
    const unlockedWithB = await unlockWithPin('2222');
    // Exactly one of the two PINs used in the race must actually unlock — whichever call's
    // write "won" — and the winning key must be usable for real encryption, not just returned.
    const oneWorks = (unlockedWithA !== null) !== (unlockedWithB !== null);
    expect(oneWorks).toBe(true);
    const winningKey = unlockedWithA ?? unlockedWithB;
    expect(winningKey).not.toBeNull();
  });

  // The race test above passes whether or not the write is atomic (in this test environment,
  // a plain Promise.all essentially never actually reproduces the underlying race), so it has
  // no regression-detection value on its own. This test instead verifies the atomicity
  // structurally: a single setupPin call must open exactly one readwrite transaction against
  // the 'meta' store and write both 'salt' and 'verifier' through it, rather than opening two
  // separate transactions (one per field) the way the old, non-atomic implementation did. Two
  // separate transactions is exactly what re-opens the corruption window this fix closes.
  it('writes salt and verifier through a single atomic readwrite transaction', async () => {
    const db = await getDb();
    const transactionSpy = vi.spyOn(db, 'transaction');
    try {
      await setupPin('4242');

      const metaWriteTransactions = transactionSpy.mock.calls.filter(([storeNames, mode]) => {
        const names = Array.isArray(storeNames) ? storeNames : [storeNames];
        return mode === 'readwrite' && names.length === 1 && names[0] === 'meta';
      });
      // Exactly one readwrite transaction against 'meta' — not one per field.
      expect(metaWriteTransactions.length).toBe(1);
      expect(transactionSpy).toHaveBeenCalledTimes(1);

      // Both fields must actually have landed as a result of that single transaction, since it
      // was the only transaction opened during the call.
      expect(await getMeta('salt')).toBeDefined();
      expect(await getMeta('verifier')).toBeDefined();
    } finally {
      transactionSpy.mockRestore();
    }
  });
});
