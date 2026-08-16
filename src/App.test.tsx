import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import App from './App';
import { getDb, getMeta } from './storage/db';
import { setupPin } from './auth/pin';
import { restoreBackup } from './backup/backup';
import { scheduleEventReminders } from './notifications/reminders';
import { deriveKey } from './crypto/crypto';
import { getAllEntries } from './storage/entryRepository';
import * as entryRepository from './storage/entryRepository';
import type { Entry } from './models/entry';

// Derives the same CryptoKey the app is using after `setPinThroughUi` set up
// PIN '1234' -- PBKDF2 is deterministic given the same secret+salt, so a
// freshly-derived key with the salt the app already wrote to `meta` decrypts
// entries identically to the app's own in-memory key, letting tests verify
// disk state directly.
async function deriveTestKey(pin: string): Promise<CryptoKey> {
  const salt = await getMeta('salt');
  const { key } = await deriveKey(pin, salt);
  return key;
}

vi.mock('./notifications/reminders', () => ({
  scheduleEventReminders: vi.fn(),
  requestNotificationPermission: vi.fn().mockResolvedValue('granted'),
}));

// Only `restoreBackup` is wrapped so we can pause an in-flight import in one test;
// by default it still calls through to the real implementation, so every other
// test (including the export/import round-trip test below) is unaffected.
vi.mock('./backup/backup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./backup/backup')>();
  return {
    ...actual,
    restoreBackup: vi.fn(actual.restoreBackup),
  };
});

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
    const { setPendingConflicts } = await import('./sync/conflictStore');
    const { createNote } = await import('./models/entry');
    const key = await setupPin('1234');
    const local = createNote('local version', 'device-1');
    const remote = createNote('remote version', 'device-2');
    await setPendingConflicts(key, [{ local, remote }]);

    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByPlaceholderText('PIN'), '1234');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));

    expect(await screen.findByText(/local version/)).toBeInTheDocument();
    expect(screen.getByText(/remote version/)).toBeInTheDocument();
  });

  it('does not drop a note captured while a backup import is still in flight', async () => {
    const user = userEvent.setup();
    render(<App />);
    await setPinThroughUi(user);

    // Pause the import right at the `restoreBackup` call, so the merge's `localEntries`
    // closure is locked in (via ImportBackup's props at the moment Settings was opened,
    // before the capture below happens) while we simulate a note being captured mid-flight.
    // Clear prior call history first: an earlier test in this file calls the real
    // restoreBackup through this same shared mock, and without clearing, the
    // "has it been called yet" check below would already be true before this test
    // ever uploads anything.
    vi.mocked(restoreBackup).mockClear();
    let resolveRestore!: (entries: Entry[]) => void;
    vi.mocked(restoreBackup).mockImplementationOnce(
      () => new Promise<Entry[]>((resolve) => (resolveRestore = resolve))
    );

    await user.click(await screen.findByRole('button', { name: 'Settings' }));
    await user.type(screen.getByPlaceholderText('PIN or passphrase used for this backup'), 'irrelevant-secret');

    const file = new File(
      [JSON.stringify({ version: 1, salt: 'x', ciphertext: 'y' })],
      'backup.json',
      { type: 'application/json' }
    );
    await user.upload(screen.getByLabelText('backup file'), file);

    // Confirm the import is genuinely paused inside restoreBackup before proceeding,
    // so the race is deterministic rather than timing-dependent.
    await waitFor(() => expect(restoreBackup).toHaveBeenCalled());

    // Capture a new note while the import is still awaiting restoreBackup. This entry
    // exists in live `entries` state but was never part of the snapshot the in-flight
    // merge is working from.
    const captureInput = await screen.findByPlaceholderText('Jot a thought...');
    await user.type(captureInput, 'captured during import');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText('captured during import');

    // Let the import complete with a genuinely new remote entry, proving the merge ran.
    const { createNote } = await import('./models/entry');
    resolveRestore([createNote('remote import note', 'device-2')]);

    expect(await screen.findByText('remote import note')).toBeInTheDocument();
    expect(screen.getByText('captured during import')).toBeInTheDocument();
  });

  it('keeps a local edit made during an in-flight import instead of the stale imported version, in memory and on disk', async () => {
    const user = userEvent.setup();
    render(<App />);
    await setPinThroughUi(user);

    const captureInput = await screen.findByPlaceholderText('Jot a thought...');
    await user.type(captureInput, 'keep my edit');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText('keep my edit');

    vi.mocked(restoreBackup).mockClear();
    let resolveRestore!: (entries: Entry[]) => void;
    vi.mocked(restoreBackup).mockImplementationOnce(
      () => new Promise<Entry[]>((resolve) => (resolveRestore = resolve))
    );

    await user.click(await screen.findByRole('button', { name: 'Settings' }));
    await user.type(screen.getByPlaceholderText('PIN or passphrase used for this backup'), 'irrelevant-secret');

    const file = new File(
      [JSON.stringify({ version: 1, salt: 'x', ciphertext: 'y' })],
      'backup.json',
      { type: 'application/json' }
    );
    await user.upload(screen.getByLabelText('backup file'), file);
    await waitFor(() => expect(restoreBackup).toHaveBeenCalled());

    // Edit the entry while the import is paused on a snapshot taken before
    // this edit happened -- this is a genuinely more recent local change
    // than what the in-flight merge is working from.
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const input = screen.getByDisplayValue('keep my edit');
    await user.clear(input);
    await user.type(input, 'edited during import');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('edited during import');

    const { createNote } = await import('./models/entry');
    resolveRestore([createNote('remote import note', 'device-2')]);

    await screen.findByText('remote import note');
    expect(screen.getByText('edited during import')).toBeInTheDocument();
    expect(screen.queryByText('keep my edit')).not.toBeInTheDocument();

    // ImportBackup persists `merged` to disk (via saveEntry) before App's
    // callback even runs, so if App only reconciled in memory, disk would
    // still hold the stale pre-edit text. Verify a fresh disk read agrees
    // with what's on screen.
    const key = await deriveTestKey('1234');
    const disk = await getAllEntries(key);
    const target = disk.find((e) => e.text === 'edited during import' || e.text === 'keep my edit');
    expect(target?.text).toBe('edited during import');
  });

  it('rebuilds a queued conflict pair\'s "local" side from the live entry instead of the stale pre-edit snapshot, so resolving "this device\'s version" keeps the mid-flight edit', async () => {
    const user = userEvent.setup();
    render(<App />);
    await setPinThroughUi(user);

    const captureInput = await screen.findByPlaceholderText('Jot a thought...');
    await user.type(captureInput, 'pre-edit text');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText('pre-edit text');

    const key = await deriveTestKey('1234');
    const [localEntry] = await getAllEntries(key);

    vi.mocked(restoreBackup).mockClear();
    let resolveRestore!: (entries: Entry[]) => void;
    vi.mocked(restoreBackup).mockImplementationOnce(
      () => new Promise<Entry[]>((resolve) => (resolveRestore = resolve))
    );

    await user.click(await screen.findByRole('button', { name: 'Settings' }));
    await user.type(screen.getByPlaceholderText('PIN or passphrase used for this backup'), 'irrelevant-secret');

    const file = new File(
      [JSON.stringify({ version: 1, salt: 'x', ciphertext: 'y' })],
      'backup.json',
      { type: 'application/json' }
    );
    await user.upload(screen.getByLabelText('backup file'), file);
    await waitFor(() => expect(restoreBackup).toHaveBeenCalled());

    // Edit the entry while the import is paused on a snapshot taken before
    // this edit -- this is a genuinely more recent local change than what
    // the in-flight merge is working from.
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const input = screen.getByDisplayValue('pre-edit text');
    await user.clear(input);
    await user.type(input, 'mid-flight edit');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('mid-flight edit');

    // Resolve the import with a genuinely conflicting remote version of the
    // SAME entry (same id, different content; both count as "changed since
    // sync" because ImportBackup's mergeEntries call uses lastSyncAt=0).
    const remote = {
      ...localEntry,
      text: 'remote conflicting version',
      modifiedAt: localEntry.modifiedAt + 1000,
      deviceId: 'device-2',
    };
    resolveRestore([remote]);

    // The conflict resolver's "this device's version" button must show the
    // LIVE (mid-flight-edited) text, not the stale pre-edit snapshot
    // mergeEntries originally saw.
    await screen.findByText('Conflicting changes');
    const thisDeviceButton = screen.getByRole('button', { name: /This device's version/ });
    expect(thisDeviceButton).toHaveTextContent('mid-flight edit');
    expect(thisDeviceButton).not.toHaveTextContent('pre-edit text');

    await user.click(thisDeviceButton);

    // The final entry must be the mid-flight edit, both in memory and on
    // disk -- not the stale pre-edit text the conflict pair carried before
    // this fix, which would otherwise permanently overwrite the rescued
    // edit with a fresh (and therefore always-winning) modifiedAt.
    expect(await screen.findByText('mid-flight edit')).toBeInTheDocument();
    expect(screen.queryByText('pre-edit text')).not.toBeInTheDocument();

    const disk = await getAllEntries(key);
    const target = disk.find((e) => e.id === localEntry.id);
    expect(target?.text).toBe('mid-flight edit');
  });

  it('keeps a local delete (tombstone) made during an in-flight import instead of resurrecting the stale version, in memory and on disk', async () => {
    const user = userEvent.setup();
    render(<App />);
    await setPinThroughUi(user);

    const captureInput = await screen.findByPlaceholderText('Jot a thought...');
    await user.type(captureInput, 'delete me during import');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText('delete me during import');

    vi.mocked(restoreBackup).mockClear();
    let resolveRestore!: (entries: Entry[]) => void;
    vi.mocked(restoreBackup).mockImplementationOnce(
      () => new Promise<Entry[]>((resolve) => (resolveRestore = resolve))
    );

    await user.click(await screen.findByRole('button', { name: 'Settings' }));
    await user.type(screen.getByPlaceholderText('PIN or passphrase used for this backup'), 'irrelevant-secret');

    const file = new File(
      [JSON.stringify({ version: 1, salt: 'x', ciphertext: 'y' })],
      'backup.json',
      { type: 'application/json' }
    );
    await user.upload(screen.getByLabelText('backup file'), file);
    await waitFor(() => expect(restoreBackup).toHaveBeenCalled());

    // Delete the entry while the import is paused on a snapshot taken before
    // this delete happened.
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByText('delete me during import')).not.toBeInTheDocument());

    const { createNote } = await import('./models/entry');
    resolveRestore([createNote('remote import note 2', 'device-2')]);

    await screen.findByText('remote import note 2');
    expect(screen.queryByText('delete me during import')).not.toBeInTheDocument();

    // Same disk-vs-memory concern as the edit case above: ImportBackup
    // already wrote the stale (non-deleted) version to disk before App's
    // callback ran.
    const key = await deriveTestKey('1234');
    const disk = await getAllEntries(key);
    const target = disk.find((e) => e.text === 'delete me during import');
    expect(target?.deleted).toBe(true);
  });

  it('does not render the conflict resolver until entries have finished loading, avoiding a race where a slow entries load reverts a resolution', async () => {
    const key = await setupPin('1234');
    const { setPendingConflicts } = await import('./sync/conflictStore');
    const { createNote } = await import('./models/entry');
    const local = createNote('local version', 'device-1');
    const remote = createNote('remote version', 'device-2');
    await setPendingConflicts(key, [{ local, remote }]);

    let resolveEntries!: (entries: Entry[]) => void;
    const spy = vi
      .spyOn(entryRepository, 'getAllEntries')
      .mockImplementationOnce(() => new Promise<Entry[]>((resolve) => (resolveEntries = resolve)));

    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByPlaceholderText('PIN'), '1234');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));

    // Entries are still loading (the mocked getAllEntries call is paused).
    // The conflict resolver must not render yet: if it could, a user
    // resolving it right here would have their choice reverted the moment
    // the slow load finally lands and overwrites `entries` wholesale. Give
    // the (real, unmocked) getPendingConflicts call plenty of real wall-clock
    // time to finish first, so this isn't just an accidental timing win.
    await waitFor(() => expect(spy).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.queryByText(/local version/)).not.toBeInTheDocument();
    expect(screen.queryByText('Conflicting changes')).not.toBeInTheDocument();

    resolveEntries([]);

    expect(await screen.findByText(/local version/)).toBeInTheDocument();
    spy.mockRestore();
  });

  it('does not overwrite persisted pending conflicts with the initial empty array while the entries/conflicts load is still pending', async () => {
    const key = await setupPin('1234');
    const { setPendingConflicts, getPendingConflicts } = await import('./sync/conflictStore');
    const { createNote } = await import('./models/entry');
    const local = createNote('local version', 'device-1');
    const remote = createNote('remote version', 'device-2');
    await setPendingConflicts(key, [{ local, remote }]);

    // Hang the entries load forever, so the load effect's `.then` (which is
    // the only place `conflictsLoaded` should be able to flip to true) never
    // runs. This simulates the exact window in which the persistence effect
    // could otherwise fire with the still-default `conflicts=[]` and clobber
    // whatever is already in storage, before it's ever been read back in.
    // This mock hangs forever by design, so it MUST be restored in a
    // `finally` -- if the assertion below throws before an unconditional
    // `mockRestore()` runs, every subsequent test in this file would try to
    // render `<App />` against a permanently-hung `getAllEntries` and fail
    // for an unrelated reason.
    const spy = vi.spyOn(entryRepository, 'getAllEntries').mockImplementation(() => new Promise(() => {}));

    try {
      const user = userEvent.setup();
      render(<App />);
      await user.type(await screen.findByPlaceholderText('PIN'), '1234');
      await user.click(screen.getByRole('button', { name: 'Unlock' }));

      // Give the (buggy) persistence effect plenty of real wall-clock time to
      // fire and write over storage, if it's going to.
      await waitFor(() => expect(spy).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 300));

      const stillPersisted = await getPendingConflicts(key);
      expect(stillPersisted).toEqual([{ local, remote }]);
    } finally {
      spy.mockRestore();
    }
  });

  it('hides the conflict resolver after clicking "Decide later", without discarding the conflict', async () => {
    const key = await setupPin('1234');
    const { setPendingConflicts } = await import('./sync/conflictStore');
    const { createNote } = await import('./models/entry');
    const local = createNote('local version', 'device-1');
    const remote = createNote('remote version', 'device-2');
    await setPendingConflicts(key, [{ local, remote }]);

    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByPlaceholderText('PIN'), '1234');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));

    await screen.findByText(/local version/);
    await user.click(screen.getByRole('button', { name: 'Decide later' }));

    expect(screen.queryByText(/local version/)).not.toBeInTheDocument();
    // Settings/Sync must be usable now instead of being permanently blocked
    // by the deferred conflict.
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });

  it('shows a visible error and keeps the conflict queued if saving the resolved entry fails', async () => {
    const key = await setupPin('1234');
    const { setPendingConflicts } = await import('./sync/conflictStore');
    const { createNote } = await import('./models/entry');
    const local = createNote('local version', 'device-1');
    const remote = createNote('remote version', 'device-2');
    await setPendingConflicts(key, [{ local, remote }]);

    const saveSpy = vi.spyOn(entryRepository, 'saveEntry').mockRejectedValueOnce(new Error('disk full'));

    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByPlaceholderText('PIN'), '1234');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));

    await user.click(await screen.findByText(/local version/));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not save/i);
    // The conflict must still be there to retry -- not silently dropped.
    expect(screen.getByText(/local version/)).toBeInTheDocument();
    expect(screen.getByText(/remote version/)).toBeInTheDocument();

    saveSpy.mockRestore();
  });

  it('surfaces a visible error if re-saving a reconciled entry to disk fails after a merge, instead of silently swallowing it', async () => {
    const user = userEvent.setup();
    render(<App />);
    await setPinThroughUi(user);

    const captureInput = await screen.findByPlaceholderText('Jot a thought...');
    await user.type(captureInput, 'keep my edit for save failure test');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText('keep my edit for save failure test');

    vi.mocked(restoreBackup).mockClear();
    let resolveRestore!: (entries: Entry[]) => void;
    vi.mocked(restoreBackup).mockImplementationOnce(
      () => new Promise<Entry[]>((resolve) => (resolveRestore = resolve))
    );

    await user.click(await screen.findByRole('button', { name: 'Settings' }));
    await user.type(screen.getByPlaceholderText('PIN or passphrase used for this backup'), 'irrelevant-secret');

    const file = new File(
      [JSON.stringify({ version: 1, salt: 'x', ciphertext: 'y' })],
      'backup.json',
      { type: 'application/json' }
    );
    await user.upload(screen.getByLabelText('backup file'), file);
    await waitFor(() => expect(restoreBackup).toHaveBeenCalled());

    // Edit while the import is paused, so handleMerged's reconciliation will
    // need to re-save this entry (the live edit wins over the stale
    // snapshot ImportBackup already wrote to disk).
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const input = screen.getByDisplayValue('keep my edit for save failure test');
    await user.clear(input);
    await user.type(input, 'edited but resave will fail');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('edited but resave will fail');

    // Make ONLY the eventual re-save of this specific entry fail, letting
    // every other saveEntry call (the edit itself, already done above, and
    // ImportBackup's own writes of `merged`) go through normally.
    const actualSaveEntry = entryRepository.saveEntry;
    const saveSpy = vi.spyOn(entryRepository, 'saveEntry').mockImplementation((k, entry) => {
      if (entry.text === 'edited but resave will fail') {
        return Promise.reject(new Error('disk full'));
      }
      return actualSaveEntry(k, entry);
    });

    try {
      const { createNote } = await import('./models/entry');
      resolveRestore([createNote('remote import note for save failure test', 'device-2')]);

      await screen.findByText('remote import note for save failure test');

      // Settings is open at this point, and ExportSettings always renders
      // its own unrelated `role="alert"` warning banner -- so match on this
      // specific message's text rather than querying by role, to avoid
      // ambiguity between the two.
      const alertEl = await screen.findByText(/could not save some changes to disk/i);
      expect(alertEl).toHaveAttribute('role', 'alert');
      // In-memory state must still reflect the correct reconciled edit even
      // though the disk re-save failed.
      expect(screen.getByText('edited but resave will fail')).toBeInTheDocument();
    } finally {
      saveSpy.mockRestore();
    }
  });

  it('replaces a stale pending conflict for the same entry id when a fresh conflict arrives for it', async () => {
    const user = userEvent.setup();
    render(<App />);
    await setPinThroughUi(user);

    const captureInput = await screen.findByPlaceholderText('Jot a thought...');
    await user.type(captureInput, 'shared entry');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText('shared entry');

    const key = await deriveTestKey('1234');
    const [localEntry] = await getAllEntries(key);

    const remote1 = { ...localEntry, text: 'remote v1', tags: [], modifiedAt: localEntry.modifiedAt + 1000, deviceId: 'device-2' };
    const remote2 = { ...localEntry, text: 'remote v2', tags: [], modifiedAt: localEntry.modifiedAt + 2000, deviceId: 'device-2' };

    vi.mocked(restoreBackup).mockClear();
    vi.mocked(restoreBackup).mockResolvedValueOnce([remote1]).mockResolvedValueOnce([remote2]);

    await user.click(await screen.findByRole('button', { name: 'Settings' }));
    await user.type(screen.getByPlaceholderText('PIN or passphrase used for this backup'), 'irrelevant-secret');

    const file1 = new File(
      [JSON.stringify({ version: 1, salt: 'x', ciphertext: 'y' })],
      'backup1.json',
      { type: 'application/json' }
    );
    await user.upload(screen.getByLabelText('backup file'), file1);
    await screen.findByText(/remote v1/);

    const file2 = new File(
      [JSON.stringify({ version: 1, salt: 'x', ciphertext: 'y' })],
      'backup2.json',
      { type: 'application/json' }
    );
    await user.upload(screen.getByLabelText('backup file'), file2);

    // The stale conflict1 (still pairing the entry with "remote v1") should
    // have been replaced by the fresh conflict2 for the same entry id --
    // not merely appended after it.
    expect(await screen.findByText(/remote v2/)).toBeInTheDocument();
    expect(screen.queryByText(/remote v1/)).not.toBeInTheDocument();

    // Resolving the one remaining conflict should clear the resolver
    // entirely, proving there wasn't a second, stale entry left queued
    // behind it that could later revert this choice.
    await user.click(screen.getByText(/remote v2/));
    await waitFor(() => expect(screen.queryByText('Conflicting changes')).not.toBeInTheDocument());
  });

  it('clears a stale conflictError when the user defers, so it does not linger onto the resolver reappearing later', async () => {
    const key = await setupPin('1234');
    const { setPendingConflicts } = await import('./sync/conflictStore');
    const { createNote } = await import('./models/entry');
    const local = createNote('local version for defer test', 'device-1');
    const remote = createNote('remote version for defer test', 'device-2');
    await setPendingConflicts(key, [{ local, remote }]);

    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByPlaceholderText('PIN'), '1234');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));

    const saveSpy = vi.spyOn(entryRepository, 'saveEntry').mockRejectedValueOnce(new Error('disk full'));
    try {
      await user.click(await screen.findByText(/local version for defer test/));
      expect(await screen.findByText(/could not save your chosen version/i)).toBeInTheDocument();
    } finally {
      saveSpy.mockRestore();
    }

    await user.click(screen.getByRole('button', { name: 'Decide later' }));
    expect(screen.queryByText(/local version for defer test/)).not.toBeInTheDocument();

    // Capture an unrelated note, then bring in an unrelated conflicting
    // import for it. This flips `conflictsDeferred` back to false, so the
    // resolver reappears showing the ORIGINAL (unchanged, not superseded)
    // deferred conflict again -- proving any error-clearing we observe here
    // came from onDefer itself, not from the separate "fresh conflict
    // replaces the same id" path (which doesn't apply, since this entry's
    // id was never touched again).
    const captureInput = await screen.findByPlaceholderText('Jot a thought...');
    await user.type(captureInput, 'unrelated entry for defer test');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText('unrelated entry for defer test');

    const entryKey = await deriveTestKey('1234');
    const allEntries = await getAllEntries(entryKey);
    const unrelatedEntry = allEntries.find((e) => e.text === 'unrelated entry for defer test')!;
    const conflictingRemote = {
      ...unrelatedEntry,
      text: 'unrelated remote conflict',
      modifiedAt: unrelatedEntry.modifiedAt + 1000,
      deviceId: 'device-3',
    };

    vi.mocked(restoreBackup).mockClear();
    vi.mocked(restoreBackup).mockResolvedValueOnce([conflictingRemote]);

    await user.click(await screen.findByRole('button', { name: 'Settings' }));
    await user.type(screen.getByPlaceholderText('PIN or passphrase used for this backup'), 'irrelevant-secret');
    const file = new File(
      [JSON.stringify({ version: 1, salt: 'x', ciphertext: 'y' })],
      'backup.json',
      { type: 'application/json' }
    );
    await user.upload(screen.getByLabelText('backup file'), file);

    // The resolver reappears showing the original deferred conflict again
    // (it's still first in the queue), with no stale error attached.
    // (Settings is open here, and ExportSettings always renders its own
    // unrelated `role="alert"` warning banner, so check specifically for
    // the absence of the conflictError text rather than querying by role.)
    expect(await screen.findByText(/local version for defer test/)).toBeInTheDocument();
    expect(screen.queryByText(/could not save your chosen version/i)).not.toBeInTheDocument();
  });

  it('clears a stale conflictError when a fresh conflict replaces the pending one for the same entry id', async () => {
    const user = userEvent.setup();
    render(<App />);
    await setPinThroughUi(user);

    const captureInput = await screen.findByPlaceholderText('Jot a thought...');
    await user.type(captureInput, 'shared entry for error clear test');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText('shared entry for error clear test');

    const key = await deriveTestKey('1234');
    const [localEntry] = await getAllEntries(key);

    const remote1 = {
      ...localEntry,
      text: 'remote v1 for error test',
      modifiedAt: localEntry.modifiedAt + 1000,
      deviceId: 'device-2',
    };
    const remote2 = {
      ...localEntry,
      text: 'remote v2 for error test',
      modifiedAt: localEntry.modifiedAt + 2000,
      deviceId: 'device-2',
    };

    vi.mocked(restoreBackup).mockClear();
    vi.mocked(restoreBackup).mockResolvedValueOnce([remote1]).mockResolvedValueOnce([remote2]);

    await user.click(await screen.findByRole('button', { name: 'Settings' }));
    await user.type(screen.getByPlaceholderText('PIN or passphrase used for this backup'), 'irrelevant-secret');

    const file1 = new File(
      [JSON.stringify({ version: 1, salt: 'x', ciphertext: 'y' })],
      'backup1.json',
      { type: 'application/json' }
    );
    await user.upload(screen.getByLabelText('backup file'), file1);
    await screen.findByText(/remote v1 for error test/);

    // Make resolving this first conflict fail, so a visible error is queued
    // alongside it. Settings is already open here, and ExportSettings
    // always renders its own unrelated `role="alert"` warning banner, so
    // match on this specific message's text rather than querying by role.
    const saveSpy = vi.spyOn(entryRepository, 'saveEntry').mockRejectedValueOnce(new Error('disk full'));
    try {
      await user.click(screen.getByText(/remote v1 for error test/));
      expect(await screen.findByText(/could not save your chosen version/i)).toBeInTheDocument();
    } finally {
      saveSpy.mockRestore();
    }

    // A fresh conflict for the SAME entry id arrives, superseding the stale
    // (and still-erroring) one.
    const file2 = new File(
      [JSON.stringify({ version: 1, salt: 'x', ciphertext: 'y' })],
      'backup2.json',
      { type: 'application/json' }
    );
    await user.upload(screen.getByLabelText('backup file'), file2);

    await screen.findByText(/remote v2 for error test/);
    // The stale error from resolving the earlier (now-superseded) conflict
    // must not linger onto this new, unrelated conflict.
    expect(screen.queryByText(/could not save your chosen version/i)).not.toBeInTheDocument();
  });
});
