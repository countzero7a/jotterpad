import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { ImportBackup } from './ImportBackup';
import { createBackup } from '../backup/backup';
import { createNote } from '../models/entry';
import { deriveKey } from '../crypto/crypto';

function makeFile(contents: string): File {
  return new File([contents], 'backup.json', { type: 'application/json' });
}

describe('ImportBackup', () => {
  it('merges a valid backup and calls onImported', async () => {
    const backup = await createBackup('correct secret', [createNote('imported thought', 'device-1')]);
    const { key } = await deriveKey('local-pin');
    const user = userEvent.setup();
    const onImported = vi.fn();

    render(<ImportBackup cryptoKey={key} localEntries={[]} onImported={onImported} />);
    await user.type(screen.getByPlaceholderText('PIN or passphrase used for this backup'), 'correct secret');
    await user.upload(
      screen.getByLabelText('backup file'),
      makeFile(JSON.stringify(backup))
    );

    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1), { timeout: 5000 });
    const [merged] = onImported.mock.calls[0];
    expect(merged.some((e: { text: string }) => e.text === 'imported thought')).toBe(true);
  });

  it('shows an error for the wrong secret', async () => {
    const backup = await createBackup('correct secret', [createNote('x', 'device-1')]);
    const { key } = await deriveKey('local-pin');
    const user = userEvent.setup();

    render(<ImportBackup cryptoKey={key} localEntries={[]} onImported={vi.fn()} />);
    await user.type(screen.getByPlaceholderText('PIN or passphrase used for this backup'), 'wrong secret');
    await user.upload(
      screen.getByLabelText('backup file'),
      makeFile(JSON.stringify(backup))
    );

    expect(await screen.findByText(/could not decrypt/i, {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it('shows an error for invalid JSON in the backup file', async () => {
    const { key } = await deriveKey('local-pin');
    const user = userEvent.setup();

    render(<ImportBackup cryptoKey={key} localEntries={[]} onImported={vi.fn()} />);
    await user.type(screen.getByPlaceholderText('PIN or passphrase used for this backup'), 'some secret');
    await user.upload(
      screen.getByLabelText('backup file'),
      makeFile('not valid json')
    );

    expect(await screen.findByText(/could not decrypt/i, {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it('shows an error when the decrypted backup is not a valid entry array', async () => {
    const backup = await createBackup('correct secret', []);
    // Tamper with the backup after encryption isn't practical here, so instead simulate a
    // corrupted decrypted payload by creating a backup whose "entries" were never real Entry
    // objects — patch restoreBackup's output shape indirectly via a backup created from bad data.
    const badEntries = [{ bogus: true }] as unknown as Parameters<typeof createBackup>[1];
    const badBackup = await createBackup('correct secret', badEntries);
    const { key } = await deriveKey('local-pin');
    const user = userEvent.setup();
    render(<ImportBackup cryptoKey={key} localEntries={[]} onImported={vi.fn()} />);
    await user.type(screen.getByPlaceholderText('PIN or passphrase used for this backup'), 'correct secret');
    await user.upload(screen.getByLabelText('backup file'), makeFile(JSON.stringify(badBackup)));
    expect(await screen.findByText(/corrupted or is not a jotterpad backup/i)).toBeInTheDocument();
  });
});
