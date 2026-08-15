import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { prepareOutgoingBundle, applyScannedBundle, markBundleSent, SyncBundle } from './syncActions';
import { parseFrame, FrameReassembler } from './qrProtocol';
import { createNote } from '../models/entry';
import { deriveKey } from '../crypto/crypto';
import { getDb } from '../storage/db';
import { saveEntry } from '../storage/entryRepository';

// This file exercises the REAL production functions in syncActions.ts end to
// end (real fake-indexeddb, real crypto, real QR frame chunking/reassembly),
// unlike syncProtocol.test.ts, which only proves the protocol *design* is
// correct via its own local reimplementation of show/scan. That gap is exactly
// how the lastSentAt-vs-lastSyncAt regression this task fixes went unguarded
// at the production level: reverting prepareOutgoingBundle to use lastSyncAt
// does not fail syncProtocol.test.ts, but it must fail the tests below.
//
// Because getDb() is a module-level singleton IndexedDB connection shared by
// the whole process, and getLastSyncAt/getLastSentAt/getAllEntries all read
// from that single shared 'entries'/'meta' object store, two-device scenarios
// have to snapshot one device's storage and swap in the other device's before
// each "turn", the same way resetDb() in syncActions.test.ts clears the store
// between tests.

interface DbSnapshot {
  entries: { id: string; blob: string }[];
  meta: { key: string; value: string }[];
}

async function snapshotDb(): Promise<DbSnapshot> {
  const db = await getDb();
  const entries = await db.getAll('entries');
  const metaKeys = await db.getAllKeys('meta');
  const metaValues = await db.getAll('meta');
  const meta = metaKeys.map((key, i) => ({ key, value: metaValues[i] }));
  return { entries, meta };
}

async function restoreDb(snapshot: DbSnapshot): Promise<void> {
  const db = await getDb();
  await db.clear('entries');
  await db.clear('meta');
  for (const entry of snapshot.entries) {
    await db.put('entries', entry);
  }
  for (const { key, value } of snapshot.meta) {
    await db.put('meta', value, key);
  }
}

async function resetDb(): Promise<void> {
  const db = await getDb();
  await db.clear('entries');
  await db.clear('meta');
}

function decodeFrames(frames: string[]): SyncBundle {
  const reassembler = new FrameReassembler();
  frames.forEach((f) => reassembler.addFrame(parseFrame(f)));
  return reassembler.getResult<SyncBundle>();
}

describe('syncActions integration: production-level two-device round trip', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('converges both devices on all notes, including a note the scanning device shows in the same session it just scanned in', async () => {
    const { key } = await deriveKey('shared-passphrase');

    // ---- Device A's local storage: 2 notes, never synced before ----
    await resetDb();
    const aNote1 = createNote('A note 1', 'device-a');
    aNote1.modifiedAt = 1000;
    const aNote2 = createNote('A note 2', 'device-a');
    aNote2.modifiedAt = 1100;
    await saveEntry(key, aNote1);
    await saveEntry(key, aNote2);
    let aEntries = [aNote1, aNote2];

    // A shows its changes and marks them sent.
    const { frames: aFrames, sentEntries: aSent } = await prepareOutgoingBundle('device-a', aEntries);
    expect(aSent.map((e) => e.text).sort()).toEqual(['A note 1', 'A note 2']);
    await markBundleSent(aSent);

    // Snapshot A's storage so we can swap in B's for B's turn.
    const aSnapshot = await snapshotDb();

    // ---- Device B's local storage: 1 note, never synced before ----
    await resetDb();
    const bNote1 = createNote('B note 1', 'device-b');
    bNote1.modifiedAt = 1050;
    await saveEntry(key, bNote1);
    let bEntries = [bNote1];

    // B scans A's frames (real chunk/reassemble round trip) and merges them in.
    const aBundle = decodeFrames(aFrames);
    expect(aBundle.senderDeviceId).toBe('device-a');
    const { merged: bMerged, conflicts: bConflicts } = await applyScannedBundle(key, bEntries, aBundle);
    expect(bConflicts).toHaveLength(0);
    expect(bMerged.map((e) => e.text).sort()).toEqual(['A note 1', 'A note 2', 'B note 1']);
    bEntries = bMerged;

    // B now shows its own changes in the SAME session, immediately after scanning.
    // applyScannedBundle just advanced B's lastSyncAt to Date.now() (a real wall-clock
    // timestamp, far larger than the small hand-assigned modifiedAt values above). If
    // prepareOutgoingBundle used lastSyncAt (the old, buggy behavior) instead of
    // lastSentAt (which is still 0 for B -- B has never sent anything), this filter
    // would exclude every entry, including B's own never-before-sent note.
    const { frames: bFrames, sentEntries: bSent } = await prepareOutgoingBundle('device-b', bEntries);
    expect(bSent.map((e) => e.text)).toContain('B note 1');
    await markBundleSent(bSent);

    // Snapshot B's final state (used for the convergence assertion below).
    const bFinalEntries = bEntries;

    // ---- Back to device A: restore A's storage and have it scan B's frames ----
    await restoreDb(aSnapshot);
    const bBundle = decodeFrames(bFrames);
    expect(bBundle.senderDeviceId).toBe('device-b');
    const { merged: aMerged, conflicts: aConflicts } = await applyScannedBundle(key, aEntries, bBundle);
    expect(aConflicts).toHaveLength(0);
    aEntries = aMerged;

    // Both devices must converge on all 3 notes.
    expect(aEntries.map((e) => e.text).sort()).toEqual(['A note 1', 'A note 2', 'B note 1']);
    expect(bFinalEntries.map((e) => e.text).sort()).toEqual(['A note 1', 'A note 2', 'B note 1']);
  });
});
