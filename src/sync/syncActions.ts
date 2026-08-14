import { Entry } from '../models/entry';
import { mergeEntries, ConflictPair, selectChangedSince } from './merge';
import { chunkPayload } from './qrProtocol';
import { saveEntry } from '../storage/entryRepository';
import { getLastSyncAt, setLastSyncAt, getLastSentAt, setLastSentAt } from '../storage/db';

export interface SyncBundle {
  senderDeviceId: string;
  entries: Entry[];
}

export async function prepareOutgoingBundle(deviceId: string, entries: Entry[]): Promise<string[]> {
  const lastSentAt = await getLastSentAt();
  const changed = selectChangedSince(entries, lastSentAt);
  const bundle: SyncBundle = { senderDeviceId: deviceId, entries: changed };
  return chunkPayload(bundle, crypto.randomUUID());
}

export async function markBundleSent(): Promise<void> {
  await setLastSentAt(Date.now());
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
