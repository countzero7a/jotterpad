import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { prepareOutgoingBundle, applyScannedBundle, markBundleSent, SyncBundle } from './syncActions';
import { parseFrame, FrameReassembler } from './qrProtocol';
import { createNote } from '../models/entry';
import { deriveKey } from '../crypto/crypto';
import { getDb, setLastSyncAt, setLastSentAt } from '../storage/db';
import { getAllEntries } from '../storage/entryRepository';

async function resetDb() {
  const db = await getDb();
  await db.clear('entries');
  await db.clear('meta');
}

describe('syncActions', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('prepareOutgoingBundle only includes entries changed since the last sync', async () => {
    await setLastSentAt(1000);
    const oldEntry = createNote('old', 'device-a');
    oldEntry.modifiedAt = 500;
    const newEntry = createNote('new', 'device-a');
    newEntry.modifiedAt = 2000;

    const frames = await prepareOutgoingBundle('device-a', [oldEntry, newEntry]);
    const reassembler = new FrameReassembler();
    frames.forEach((f) => reassembler.addFrame(parseFrame(f)));
    const bundle = reassembler.getResult<SyncBundle>();

    expect(bundle.senderDeviceId).toBe('device-a');
    expect(bundle.entries).toHaveLength(1);
    expect(bundle.entries[0].text).toBe('new');
  });

  it('applyScannedBundle merges remote entries and persists them', async () => {
    const { key } = await deriveKey('1234');
    const remoteEntry = createNote('from the other device', 'device-b');
    const bundle: SyncBundle = { senderDeviceId: 'device-b', entries: [remoteEntry] };

    const { merged, conflicts } = await applyScannedBundle(key, [], bundle);
    expect(merged).toHaveLength(1);
    expect(conflicts).toHaveLength(0);

    const persisted = await getAllEntries(key);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].text).toBe('from the other device');
  });

  it('applyScannedBundle advances lastSyncAt', async () => {
    const { key } = await deriveKey('1234');
    const bundle: SyncBundle = { senderDeviceId: 'device-b', entries: [] };
    const before = Date.now();
    await applyScannedBundle(key, [], bundle);
    const { getLastSyncAt } = await import('../storage/db');
    expect(await getLastSyncAt()).toBeGreaterThanOrEqual(before);
  });

  it('applyScannedBundle surfaces conflicts without silently overwriting local changes', async () => {
    const { key } = await deriveKey('1234');
    await setLastSyncAt(1000);
    const localEntry = createNote('local edit', 'device-a');
    localEntry.id = 'shared-id';
    localEntry.modifiedAt = 2000;
    const remoteEntry = createNote('remote edit', 'device-b');
    remoteEntry.id = 'shared-id';
    remoteEntry.modifiedAt = 2100;

    const bundle: SyncBundle = { senderDeviceId: 'device-b', entries: [remoteEntry] };
    const { conflicts } = await applyScannedBundle(key, [localEntry], bundle);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].local.text).toBe('local edit');
    expect(conflicts[0].remote.text).toBe('remote edit');
  });

  it('markBundleSent advances lastSentAt, and a subsequent call reflects it', async () => {
    const { setLastSentAt: seedSentAt } = await import('../storage/db');
    await seedSentAt(0);
    const before = Date.now();
    await markBundleSent();
    const { getLastSentAt } = await import('../storage/db');
    expect(await getLastSentAt()).toBeGreaterThanOrEqual(before);
  });
});
