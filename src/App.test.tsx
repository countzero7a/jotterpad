import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import App from './App';
import { getDb } from './storage/db';
import { setupPin } from './auth/pin';
import { restoreBackup } from './backup/backup';
import { scheduleEventReminders } from './notifications/reminders';

vi.mock('./notifications/reminders', () => ({
  scheduleEventReminders: vi.fn(),
  requestNotificationPermission: vi.fn().mockResolvedValue('granted'),
}));

async function resetDb() {
  const db = await getDb();
  await db.clear('entries');
  await db.clear('meta');
}

async function setPinThroughUi(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByPlaceholderText('PIN'), '1234');
  await user.type(screen.getByPlaceholderText('Confirm PIN'), '1234');
  await user.click(screen.getByRole('button', { name: 'Set PIN' }));
}

function readBlobAsText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe('App', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('shows the PIN setup screen when no PIN is configured', async () => {
    render(<App />);
    expect(await screen.findByText(/permanently unrecoverable/i)).toBeInTheDocument();
  });

  it('unlocks into the timeline after setting a PIN, and a captured note appears', async () => {
    const user = userEvent.setup();
    render(<App />);
    await setPinThroughUi(user);

    await user.type(await screen.findByPlaceholderText('Jot a thought...'), 'first captured thought');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('first captured thought')).toBeInTheDocument();
  });

  it('shows the unlock form (not setup) when a PIN is already configured, and unlocking reveals the timeline', async () => {
    await setupPin('4242');
    const user = userEvent.setup();
    render(<App />);

    const pinInput = await screen.findByPlaceholderText('PIN');
    expect(screen.queryByPlaceholderText('Confirm PIN')).not.toBeInTheDocument();
    expect(screen.queryByText(/permanently unrecoverable/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeInTheDocument();

    await user.type(pinInput, '4242');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));

    expect(await screen.findByRole('button', { name: 'Sync' }, { timeout: 10000 })).toBeInTheDocument();
  });

  it('deletes an entry, removing it from the rendered timeline', async () => {
    const user = userEvent.setup();
    render(<App />);
    await setPinThroughUi(user);

    await user.type(await screen.findByPlaceholderText('Jot a thought...'), 'delete me');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText('delete me');

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.queryByText('delete me')).not.toBeInTheDocument());
  });

  it('edits a captured note and shows the updated text', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByPlaceholderText('PIN'), '1234');
    await user.type(screen.getByPlaceholderText('Confirm PIN'), '1234');
    await user.click(screen.getByRole('button', { name: 'Set PIN' }));

    await user.type(await screen.findByPlaceholderText('Jot a thought...'), 'buy milk');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText('buy milk');

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const input = screen.getByDisplayValue('buy milk');
    await user.clear(input);
    await user.type(input, 'buy oat milk');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('buy oat milk')).toBeInTheDocument();
    expect(screen.queryByText('buy milk')).not.toBeInTheDocument();
  });

  it('gives ExportSettings the full entry list even when a filter hides an entry from the visible timeline', async () => {
    let capturedBlob: Blob | null = null;
    URL.createObjectURL = vi.fn((blob: Blob) => {
      capturedBlob = blob;
      return 'blob:mock';
    });
    URL.revokeObjectURL = vi.fn();

    const user = userEvent.setup();
    render(<App />);
    await setPinThroughUi(user);

    const captureInput = await screen.findByPlaceholderText('Jot a thought...');
    await user.type(captureInput, 'visible note');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.type(captureInput, 'hidden note');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await screen.findByText('visible note');
    await screen.findByText('hidden note');

    // Filter the visible timeline down so it excludes "hidden note".
    await user.type(screen.getByPlaceholderText('Search notes and events...'), 'visible note');
    expect(screen.queryByText('hidden note')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.type(screen.getByPlaceholderText('Enter device PIN'), '1234');
    await user.click(screen.getByRole('button', { name: 'Export' }));

    await waitFor(() => expect(capturedBlob).not.toBeNull(), { timeout: 10000 });
    const backup = JSON.parse(await readBlobAsText(capturedBlob!));
    const restored = await restoreBackup('1234', backup);

    expect(restored.some((e) => e.text === 'visible note')).toBe(true);
    expect(restored.some((e) => e.text === 'hidden note')).toBe(true);
  });

  it('keeps an active tag filter chip visible and clickable after its last entry is deleted', async () => {
    const user = userEvent.setup();
    render(<App />);
    await setPinThroughUi(user);

    const captureInput = await screen.findByPlaceholderText('Jot a thought...');
    await user.type(captureInput, 'buy milk #work');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText('buy milk #work');

    // Select the #work filter chip.
    await user.click(screen.getByRole('button', { name: '#work' }));

    // Delete the only entry carrying the #work tag.
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByText('buy milk #work')).not.toBeInTheDocument());

    // The chip must stay visible (and clickable) even though no non-deleted
    // entry carries #work anymore — otherwise the filter is stuck on forever.
    expect(screen.getByRole('button', { name: '#work' })).toBeInTheDocument();

    // Capture a new note that does NOT have the #work tag. While the stale
    // filter is still active, it should be hidden from the timeline.
    await user.type(captureInput, 'fresh thought');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.queryByText('fresh thought')).not.toBeInTheDocument();

    // Clicking the still-visible chip clears the filter, revealing the new note.
    await user.click(screen.getByRole('button', { name: '#work' }));
    expect(await screen.findByText('fresh thought')).toBeInTheDocument();
  });

  it('reschedules reminders after entries change, not just once at initial load', async () => {
    const user = userEvent.setup();
    render(<App />);
    await setPinThroughUi(user);

    await waitFor(() => expect(vi.mocked(scheduleEventReminders).mock.calls.length).toBeGreaterThan(0));
    const callsBeforeCapture = vi.mocked(scheduleEventReminders).mock.calls.length;

    await user.type(await screen.findByPlaceholderText('Jot a thought...'), 'reminder regression note');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText('reminder regression note');

    await waitFor(() =>
      expect(vi.mocked(scheduleEventReminders).mock.calls.length).toBeGreaterThan(callsBeforeCapture)
    );
    expect(vi.mocked(scheduleEventReminders).mock.calls.length).toBeGreaterThan(1);

    const calls = vi.mocked(scheduleEventReminders).mock.calls;
    const lastCallEntries = calls[calls.length - 1][0];
    expect(lastCallEntries.some((e) => e.text === 'reminder regression note')).toBe(true);
  });

  it('shows a pending conflict that was persisted from a previous session', async () => {
    const { setPendingConflicts } = await import('./storage/db');
    const { createNote } = await import('./models/entry');
    await setupPin('1234');
    const local = createNote('local version', 'device-1');
    const remote = createNote('remote version', 'device-2');
    await setPendingConflicts([{ local, remote }]);

    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByPlaceholderText('PIN'), '1234');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));

    expect(await screen.findByText(/local version/)).toBeInTheDocument();
    expect(screen.getByText(/remote version/)).toBeInTheDocument();
  });
});
