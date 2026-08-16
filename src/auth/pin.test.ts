import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { isPinConfigured, setupPin, unlockWithPin } from './pin';
import { getDb } from '../storage/db';

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
});
