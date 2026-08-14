import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getDb, getLastSentAt, setLastSentAt, getLastSyncAt, setLastSyncAt } from './db';

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
