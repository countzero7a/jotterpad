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
// modifiedAt timestamps instead -- lastSentAt is NEVER set to a wall-clock
// reading, only ever to the modifiedAt of an entry that was genuinely part of
// a sent bundle (or left unchanged if nothing qualifies).
//
// But sentEntries can include entries that originated on the PEER: union
// semantics in mergeEntries mean a device re-sends everything it knows about
// that the peer hasn't confirmed, including the peer's own entries echoed
// back. Those entries' modifiedAt values were stamped by the PEER's clock. If
// the peer's clock runs ahead of ours, folding them into the high-water mark
// can push lastSentAt into our own future -- after which every note captured
// locally is silently and permanently excluded until local wall-clock time
// catches up. `preparedAt` is `Date.now()` read on THIS device at the moment
// the bundle was prepared (see prepareOutgoingBundle above). Rather than
// computing the max over every sentEntries and then clamping the result down
// to preparedAt -- which would collapse to preparedAt itself, a wall-clock
// reading, whenever some entry is future-skewed -- we instead exclude
// future-skewed entries from the reduce entirely: only entries with
// modifiedAt <= preparedAt get to participate in the max. A future-skewed
// peer entry simply doesn't get to contribute; it will be redundantly
// re-sent next session, which is harmless because mergeEntries' content-
// equality check makes that a no-op on the receiving end. Because the reduce
// starts at prev and only ever takes Math.max over admitted entries,
// lastSentAt is guaranteed to never regress below prev, with no separate
// clamp needed.
export async function markBundleSent(sentEntries: Entry[], preparedAt: number): Promise<void> {
  const prev = await getLastSentAt();
  const highWaterMark = sentEntries.reduce(
    (max, e) => (e.modifiedAt <= preparedAt ? Math.max(max, e.modifiedAt) : max),
    prev
  );
  await setLastSentAt(highWaterMark);
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
