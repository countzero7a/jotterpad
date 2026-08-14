import { useState, ChangeEvent } from 'react';
import { Entry } from '../models/entry';
import { BackupFile, restoreBackup } from '../backup/backup';
import { mergeEntries, ConflictPair } from '../sync/merge';
import { saveEntry } from '../storage/entryRepository';

interface ImportBackupProps {
  cryptoKey: CryptoKey;
  localEntries: Entry[];
  onImported: (merged: Entry[], conflicts: ConflictPair[]) => void;
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function ImportBackup({ cryptoKey, localEntries, onImported }: ImportBackupProps) {
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    setError('');
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      const backupFile = JSON.parse(text) as BackupFile;
      const imported = await restoreBackup(secret, backupFile);
      const { merged, conflicts } = mergeEntries(localEntries, imported, 0);
      for (const entry of merged) {
        await saveEntry(cryptoKey, entry);
      }
      onImported(merged, conflicts);
    } catch {
      setError('Could not decrypt this backup. Check the PIN/passphrase.');
    }
  }

  return (
    <div>
      <h2>Import Backup</h2>
      <input
        type="password"
        placeholder="PIN or passphrase used for this backup"
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
      />
      <label htmlFor="backup-file-input">backup file</label>
      <input id="backup-file-input" aria-label="backup file" type="file" accept="application/json" onChange={handleFile} />
      {error && <p>{error}</p>}
    </div>
  );
}
