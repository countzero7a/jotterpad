import { useState, FormEvent } from 'react';
import { Entry } from '../models/entry';
import { createBackup } from '../backup/backup';
import { unlockWithPin } from '../auth/pin';

interface ExportSettingsProps {
  entries: Entry[];
}

export function ExportSettings({ entries }: ExportSettingsProps) {
  const [choice, setChoice] = useState<'pin' | 'passphrase'>('pin');
  const [secret, setSecret] = useState('');
  const [confirmSecret, setConfirmSecret] = useState('');
  const [error, setError] = useState('');

  async function handleExport(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (choice === 'passphrase' && secret !== confirmSecret) {
      setError('Passphrases do not match.');
      return;
    }
    if (choice === 'pin') {
      const verified = await unlockWithPin(secret);
      if (!verified) {
        setError('Incorrect PIN.');
        return;
      }
    }
    const backup = await createBackup(secret, entries);
    const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jotterpad-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <form onSubmit={handleExport}>
      <h2>Export Backup</h2>
      <p role="alert">
        If you lose this PIN or passphrase, this backup file is permanently unrecoverable.
      </p>
      <label>
        <input type="radio" checked={choice === 'pin'} onChange={() => setChoice('pin')} />
        Use device PIN
      </label>
      <label>
        <input type="radio" checked={choice === 'passphrase'} onChange={() => setChoice('passphrase')} />
        Set a passphrase for this file
      </label>
      <input
        type="password"
        placeholder={choice === 'pin' ? 'Enter device PIN' : 'Enter passphrase'}
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
      />
      {choice === 'passphrase' && (
        <input
          type="password"
          placeholder="Confirm passphrase"
          value={confirmSecret}
          onChange={(e) => setConfirmSecret(e.target.value)}
        />
      )}
      {error && <p>{error}</p>}
      <button type="submit">Export</button>
    </form>
  );
}
