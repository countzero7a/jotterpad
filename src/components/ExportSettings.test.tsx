import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { ExportSettings } from './ExportSettings';
import { setupPin } from '../auth/pin';
import { getDb } from '../storage/db';
import { createNote } from '../models/entry';

async function resetDb() {
  const db = await getDb();
  await db.clear('meta');
}

describe('ExportSettings', () => {
  beforeEach(async () => {
    await resetDb();
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
  });

  it('shows the unrecoverability warning', () => {
    render(<ExportSettings entries={[]} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/unrecoverable/i);
  });

  it('rejects mismatched passphrases when the passphrase option is chosen', async () => {
    const user = userEvent.setup();
    render(<ExportSettings entries={[createNote('x', 'device-1')]} />);
    await user.click(screen.getByLabelText('Set a passphrase for this file'));
    await user.type(screen.getByPlaceholderText('Enter passphrase'), 'abcd1234');
    await user.type(screen.getByPlaceholderText('Confirm passphrase'), 'different');
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(screen.getByText(/do not match/i)).toBeInTheDocument();
  });

  it('rejects an incorrect device PIN when the PIN option is chosen', async () => {
    await setupPin('4242');
    const user = userEvent.setup();
    render(<ExportSettings entries={[createNote('x', 'device-1')]} />);
    await user.type(screen.getByPlaceholderText('Enter device PIN'), '0000');
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(await screen.findByText(/incorrect pin/i, {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it('exports successfully with the correct device PIN', async () => {
    await setupPin('4242');
    const user = userEvent.setup();
    render(<ExportSettings entries={[createNote('x', 'device-1')]} />);
    await user.type(screen.getByPlaceholderText('Enter device PIN'), '4242');
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(screen.queryByText(/incorrect pin/i)).not.toBeInTheDocument();
  });
});
