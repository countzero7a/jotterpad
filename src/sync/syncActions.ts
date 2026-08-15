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
}

export async function prepareOutgoingBundle(deviceId: string, entries: Entry[]): Promise<OutgoingBundle> {
  const lastSentAt = await getLastSentAt();
  const changed = selectChangedSince(entries, lastSentAt);
  const bundle: SyncBundle = { senderDeviceId: deviceId, entries: changed };
  const frames = chunkPayload(bundle, crypto.randomUUID());
  return { frames, sentEntries: changed };
}

// Advances lastSentAt to the highest modifiedAt among the entries that were
// actually encoded into the displayed QR bundle (never regressing below the
// current value). Using Date.now() here instead would stamp lastSentAt with
// "whenever the user tapped Done", which can be later than a note created
// while the QR codes were still on screen -- silently and permanently
// excluding that note from every future outgoing bundle.
export async function markBundleSent(sentEntries: Entry[]): Promise<void> {
  const prev = await getLastSentAt();
  const highWaterMark = sentEntries.reduce((max, e) => Math.max(max, e.modifiedAt), prev);
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
