import { deriveKey, encrypt, decrypt } from '../crypto/crypto';
import { Entry } from '../models/entry';

export interface BackupFile {
  version: 1;
  salt: string;
  ciphertext: string;
}

export async function createBackup(secret: string, entries: Entry[]): Promise<BackupFile> {
  const { key, salt } = await deriveKey(secret);
  const ciphertext = await encrypt(key, JSON.stringify(entries));
  return { version: 1, salt, ciphertext };
}

export async function restoreBackup(secret: string, file: BackupFile): Promise<Entry[]> {
  const { key } = await deriveKey(secret, file.salt);
  const json = await decrypt(key, file.ciphertext);
  return JSON.parse(json) as Entry[];
}
