import { Entry } from '../models/entry';
import { mergeEntries, ConflictPair, selectChangedSince } from './merge';
import { chunkPayload } from './qrProtocol';
import { saveEntry } from '../storage/entryRepository';
import { getLastSyncAt, setLastSyncAt, getLastSentAt, setLastSentAt } from '../storage/db';

export interface SyncBundle {
  senderDeviceId: string;
  entries: Entry[];
}

export interface OutgoingBundle {
  frames: string[];
  sentEntries: Entry[];
  preparedAt: number;
}

export async function prepareOutgoingBundle(deviceId: string, entries: Entry[]): Promise<OutgoingBundle> {
  const preparedAt = Date.now();
  const lastSentAt = await getLastSentAt();
  const changed = selectChangedSince(entries, lastSentAt);
  const bundle: SyncBundle = { senderDeviceId: deviceId, entries: changed };
  const frames = chunkPayload(bundle, crypto.randomUUID());
  return { frames, sentEntries: changed, preparedAt };
}

// Advances lastSentAt to the highest modifiedAt among the entries that were
// actually encoded into the displayed QR bundle (never regressing below the
// current value). Using Date.now() (read at markBundleSent-call time) here
// instead would stamp lastSentAt with "whenever the user tapped Done", which
// can be later than a note created while the QR codes were still on screen --
// silently and permanently excluding that note from every future outgoing
// bundle. That's why the high-water mark comes from the entries' own
// modifiedAt timestamps instead.
//
// But sentEntries can include entries that originated on the PEER: union
// semantics in mergeEntries mean a device re-sends everything it knows about
// that the peer hasn't confirmed, including the peer's own entries echoed
// back. Those entries' modifiedAt values were stamped by the PEER's clock. If
// the peer's clock runs ahead of ours, folding them into the high-water mark
// can push lastSentAt into our own future -- after which every note captured
// locally is silently and permanently excluded until local wall-clock time
// catches up. `preparedAt` is `Date.now()` read on THIS device at the moment
// the bundle was prepared (see prepareOutgoingBundle above), so clamping the
// high-water mark to it caps lastSentAt at "now, per our own clock" no matter
// what timestamps arrived from the peer. preparedAt is never lower than prev
// in any legitimate call sequence (local time doesn't run backward), so this
// clamp is a no-op for the normal case and only bites when a peer-supplied
// timestamp is skewed into the future.
export async function markBundleSent(sentEntries: Entry[], preparedAt: number): Promise<void> {
  const prev = await getLastSentAt();
  const highWaterMark = sentEntries.reduce((max, e) => Math.max(max, e.modifiedAt), prev);
  await setLastSentAt(Math.min(highWaterMark, preparedAt));
}

export async function applyScannedBundle(
  cryptoKey: CryptoKey,
  localEntries: Entry[],
  bundle: SyncBundle
): Promise<{ merged: Entry[]; conflicts: ConflictPair[] }> {
  const lastSyncAt = await getLastSyncAt();
  const { merged, conflicts } = mergeEntries(localEntries, bundle.entries, lastSyncAt);
  for (const entry of merged) {
    await saveEntry(cryptoKey, entry);
  }
  await setLastSyncAt(Date.now());
  return { merged, conflicts };
}
