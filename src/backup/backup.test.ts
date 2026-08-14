import { describe, it, expect } from 'vitest';
import { createBackup, restoreBackup } from './backup';
import { createNote } from '../models/entry';

describe('backup', () => {
  it('round-trips entries through createBackup/restoreBackup', async () => {
    const entries = [createNote('backed up thought', 'device-1')];
    const file = await createBackup('a strong passphrase', entries);
    const restored = await restoreBackup('a strong passphrase', file);
    expect(restored).toHaveLength(1);
    expect(restored[0].text).toBe('backed up thought');
  });

  it('fails to restore with the wrong secret', async () => {
    const entries = [createNote('secret thought', 'device-1')];
    const file = await createBackup('correct secret', entries);
    await expect(restoreBackup('wrong secret', file)).rejects.toThrow();
  });

  it('stores ciphertext, not plaintext, in the backup file', async () => {
    const entries = [createNote('do not leak this', 'device-1')];
    const file = await createBackup('a passphrase', entries);
    expect(file.ciphertext).not.toContain('do not leak this');
  });
});
