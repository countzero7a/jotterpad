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

  it('prepareOutgoingBundle only includes entries changed since the last send', async () => {
    await setLastSentAt(1000);
    const oldEntry = createNote('old', 'device-a');
    oldEntry.modifiedAt = 500;
    const newEntry = createNote('new', 'device-a');
    newEntry.modifiedAt = 2000;

    const { frames, sentEntries } = await prepareOutgoingBundle('device-a', [oldEntry, newEntry]);
    const reassembler = new FrameReassembler();
    frames.forEach((f) => reassembler.addFrame(parseFrame(f)));
    const bundle = reassembler.getResult<SyncBundle>();

    expect(bundle.senderDeviceId).toBe('device-a');
    expect(bundle.entries).toHaveLength(1);
    expect(bundle.entries[0].text).toBe('new');
    expect(sentEntries).toHaveLength(1);
    expect(sentEntries[0].text).toBe('new');
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

  it('markBundleSent advances lastSentAt to the highest modifiedAt among the sent entries', async () => {
    await setLastSentAt(0);
    const entryA = createNote('a', 'device-a');
    entryA.modifiedAt = 1500;
    const entryB = createNote('b', 'device-a');
    entryB.modifiedAt = 3000;

    await markBundleSent([entryA, entryB], Date.now());

    const { getLastSentAt } = await import('../storage/db');
    expect(await getLastSentAt()).toBe(3000);
  });

  it('markBundleSent never regresses lastSentAt below its current value', async () => {
    await setLastSentAt(5000);
    const oldEntry = createNote('old', 'device-a');
    oldEntry.modifiedAt = 1000;

    await markBundleSent([oldEntry], Date.now());

    const { getLastSentAt } = await import('../storage/db');
    expect(await getLastSentAt()).toBe(5000);
  });

  it('markBundleSent leaves lastSentAt unchanged when no entries were sent', async () => {
    await setLastSentAt(2000);

    await markBundleSent([], Date.now());

    const { getLastSentAt } = await import('../storage/db');
    expect(await getLastSentAt()).toBe(2000);
  });

  it('markBundleSent does not use wall-clock time as the watermark', async () => {
    await setLastSentAt(0);
    const entry = createNote('old note shown late', 'device-a');
    entry.modifiedAt = 1000; // far in the past relative to Date.now()

    await markBundleSent([entry], Date.now());

    const { getLastSentAt } = await import('../storage/db');
    expect(await getLastSentAt()).toBe(1000);
  });

  it('excludes a peer clock-skewed entry from the watermark entirely so lastSentAt never reflects a wall-clock reading', async () => {
    await setLastSentAt(0);
    // Simulates an entry echoed back from a peer whose clock runs an hour ahead of ours.
    // Union semantics in mergeEntries mean sentEntries can include entries we originally
    // received from the peer, stamped with the peer's (skewed) clock, not ours.
    const skewedEntry = createNote('echoed from peer with a skewed clock', 'device-b');
    skewedEntry.modifiedAt = Date.now() + 60 * 60 * 1000;

    const preparedAt = Date.now(); // this device's own clock, captured at prepare time
    await markBundleSent([skewedEntry], preparedAt);

    const { getLastSentAt } = await import('../storage/db');
    const lastSentAt = await getLastSentAt();
    // The skewed entry must not inflate the watermark at all -- not even up to
    // preparedAt. It contributed nothing, so lastSentAt stays at prev (0).
    expect(lastSentAt).toBeLessThan(skewedEntry.modifiedAt);
    expect(lastSentAt).toBe(0);

    // A genuinely new local note captured after this sync must still go out next time --
    // it must not be excluded by a clock-skew-inflated watermark. Use a timestamp
    // strictly greater than preparedAt (rather than a fresh Date.now() call that
    // could tie with preparedAt) so the test can't flake on timing.
    const newLocalNote = createNote('new local note after the skewed sync', 'device-a');
    newLocalNote.modifiedAt = preparedAt + 1000;

    const { sentEntries } = await prepareOutgoingBundle('device-a', [newLocalNote]);
    expect(sentEntries.map((e) => e.text)).toContain('new local note after the skewed sync');
  });

  it('markBundleSent never regresses lastSentAt below prev even when preparedAt is behind it (backward clock step)', async () => {
    await setLastSentAt(5000);
    // A backward local clock step: preparedAt (this device's "now" at prepare
    // time) is somehow less than the already-stored watermark. No entry's
    // modifiedAt can be <= preparedAt here without also being <= prev, so
    // nothing should be able to move the watermark -- and critically, it must
    // not be "healed" downward to preparedAt either. Monotonicity is the
    // deliberate, chosen behavior, not a bug to paper over.
    const preparedAt = 4000;
    const entry = createNote('sent while clock was skewed backward', 'device-a');
    entry.modifiedAt = 3000;

    await markBundleSent([entry], preparedAt);

    const { getLastSentAt } = await import('../storage/db');
    expect(await getLastSentAt()).toBe(5000);
  });
});
