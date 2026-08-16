import { ConflictPair } from './merge';
import { getMeta, setMeta } from '../storage/db';
import { encrypt, decrypt } from '../crypto/crypto';

// Pending conflicts can contain the full text of note/event entries. Unlike
// device/sync watermarks (which are just numbers), this is user content, so
// it must be encrypted with the session's key the same way individual
// entries are (see storage/entryRepository.ts) rather than stored as
// plaintext JSON in the unencrypted `meta` store.

export async function getPendingConflicts(cryptoKey: CryptoKey): Promise<ConflictPair[]> {
  const raw = await getMeta('pendingConflicts');
  if (!raw) return [];
  try {
    const decrypted = await decrypt(cryptoKey, raw);
    return JSON.parse(decrypted) as ConflictPair[];
  } catch {
    return [];
  }
}

export async function setPendingConflicts(cryptoKey: CryptoKey, conflicts: ConflictPair[]): Promise<void> {
  const encrypted = await encrypt(cryptoKey, JSON.stringify(conflicts));
  await setMeta('pendingConflicts', encrypted);
}
