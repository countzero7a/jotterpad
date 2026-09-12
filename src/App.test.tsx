import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
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
import * as conflictStore from './sync/conflictStore';
import type { Entry } from './models/entry';
import type { ConflictPair } from './sync/merge';

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

  it('commits an edit to the timeline immediately (optimistic UI), and does not let a slow-to-complete disk write for it clobber a delete that happens afterward, in memory or on disk', async () => {
    const user = userEvent.setup();
    render(<App />);
    await setPinThroughUi(user);

    const captureInput = await screen.findByPlaceholderText('Jot a thought...');
    await user.type(captureInput, 'race entry text');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText('race entry text');

    // Hold open the entry's queued disk write triggered by the edit below
    // (matched by its post-edit text) -- every other saveEntry call
    // (including the initial capture's own save, and the delete's own
    // queued write) goes through normally.
    const actualSaveEntry = entryRepository.saveEntry;
    let resolveEditSave!: () => void;
    const editSaveGate = new Promise<void>((resolve) => {
      resolveEditSave = resolve;
    });
    let held = false;
    let editSaveCompleted = false;
    const saveSpy = vi.spyOn(entryRepository, 'saveEntry').mockImplementation(async (k, entry) => {
      if (entry.text === 'edited stale text' && !held) {
        held = true;
        await editSaveGate;
        await actualSaveEntry(k, entry);
        editSaveCompleted = true;
        return;
      }
      return actualSaveEntry(k, entry);
    });

    try {
      await user.click(screen.getByRole('button', { name: 'Edit' }));
      const input = screen.getByDisplayValue('race entry text');
      await user.clear(input);
      await user.type(input, 'edited stale text');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      // Unlike the old pessimistic (await-the-disk-write-then-commit)
      // architecture, App now commits an edit to in-memory state
      // IMMEDIATELY (optimistic UI) and queues its disk write in the
      // background -- so the edited text shows up right away, with a
      // Delete button available again, well before its own disk write
      // (held open above) has completed.
      await screen.findByText('edited stale text');
      await user.click(screen.getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(screen.queryByText('edited stale text')).not.toBeInTheDocument());

      // Now let the edit's disk write (paused this whole time, queued
      // BEFORE the delete's own queued write for the same entry id) finally
      // complete.
      resolveEditSave();
      await waitFor(() => expect(editSaveCompleted).toBe(true));
      // Give the delete's own queued write -- chained behind the edit's on
      // the same per-id write queue -- a real chance to run to completion
      // too, and potentially clobber the delete if it's going to.
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      // Always release the gate, even if an assertion above threw, so a
      // dangling held write can't leave IndexedDB mid-transaction for
      // later tests.
      resolveEditSave();
      saveSpy.mockRestore();
    }

    // The delete must win -- it happened after the edit was initiated, so
    // it reflects a genuinely newer modifiedAt. The entry must stay
    // deleted, not be resurrected by the edit's slow-to-complete write
    // landing after it, in memory or on disk.
    expect(screen.queryByText('race entry text')).not.toBeInTheDocument();
    expect(screen.queryByText('edited stale text')).not.toBeInTheDocument();

    const key = await deriveTestKey('1234');
    const disk = await getAllEntries(key);
    const target = disk.find((e) => e.text === 'race entry text' || e.text === 'edited stale text');
    expect(target?.deleted).toBe(true);
  });

  it('lets Edit and Delete take effect on an entry whose live modifiedAt is in this device\'s future (e.g. synced from a peer whose clock runs ahead), instead of silently discarding the user\'s action', async () => {
    const user = userEvent.setup();
    render(<App />);
    await setPinThroughUi(user);

    const captureInput = await screen.findByPlaceholderText('Jot a thought...');
    await user.type(captureInput, 'skew edit target');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText('skew edit target');
    await user.type(captureInput, 'skew delete target');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText('skew delete target');

    const key = await deriveTestKey('1234');
    const localEntries = await getAllEntries(key);
    const editTarget = localEntries.find((e) => e.text === 'skew edit target')!;
    const deleteTarget = localEntries.find((e) => e.text === 'skew delete target')!;

    // Simulate both entries having been synced from a peer whose clock runs
    // ten years ahead of this device's -- same id, IDENTICAL content (so
    // mergeEntries auto-merges by modifiedAt instead of flagging a
    // conflict), just a modifiedAt far in this device's future. This is
    // exactly the shape of entry the bug report describes: nothing here is
    // a conflict, it's an ordinary sync that happens to carry a
    // future-dated timestamp.
    const tenYearsMs = 10 * 365 * 24 * 60 * 60 * 1000;
    vi.mocked(restoreBackup).mockClear();
    vi.mocked(restoreBackup).mockResolvedValueOnce([
      { ...editTarget, modifiedAt: editTarget.modifiedAt + tenYearsMs },
      { ...deleteTarget, modifiedAt: deleteTarget.modifiedAt + tenYearsMs },
    ]);

    await user.click(await screen.findByRole('button', { name: 'Settings' }));
    await user.type(screen.getByPlaceholderText('PIN or passphrase used for this backup'), 'irrelevant-secret');
    const file = new File(
      [JSON.stringify({ version: 1, salt: 'x', ciphertext: 'y' })],
      'backup.json',
      { type: 'application/json' }
    );
    await user.upload(screen.getByLabelText('backup file'), file);
    await waitFor(async () => {
      const disk = await getAllEntries(key);
      expect(disk.find((e) => e.id === editTarget.id)?.modifiedAt).toBeGreaterThan(Date.now());
      expect(disk.find((e) => e.id === deleteTarget.id)?.modifiedAt).toBeGreaterThan(Date.now());
    });
    // Content-identical re-timestamps must not raise a conflict.
    expect(screen.queryByText('Conflicting changes')).not.toBeInTheDocument();

    // Edit the future-skewed entry.
    const editContainer = screen.getByText('skew edit target').closest('.entry') as HTMLElement;
    await user.click(within(editContainer).getByRole('button', { name: 'Edit' }));
    const input = screen.getByDisplayValue('skew edit target');
    await user.clear(input);
    await user.type(input, 'edited despite future skew');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // The edit must actually take effect -- not be silently discarded
    // because the live entry's modifiedAt (stamped by the skewed peer) is
    // ahead of the ordinary Date.now() this edit is stamped with.
    expect(await screen.findByText('edited despite future skew')).toBeInTheDocument();
    expect(screen.queryByText('skew edit target')).not.toBeInTheDocument();

    // Delete the other future-skewed entry.
    const deleteContainer = screen.getByText('skew delete target').closest('.entry') as HTMLElement;
    await user.click(within(deleteContainer).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByText('skew delete target')).not.toBeInTheDocument());

    // Both must actually be persisted, not just reflected in memory --
    // `commitEntryDirect`'s disk write is fire-and-forget (queued via
    // `queueEntrySave`, not awaited by the synchronous handleEdit/
    // handleDelete handlers), so wait for it to actually land instead of
    // assuming it already has by this point. This also matters for test
    // hygiene: without waiting, a slow write could still be in flight when
    // this test ends and land during a LATER test's run, after that test's
    // own `resetDb()` has already cleared the (shared, in-memory)
    // fake-indexeddb -- corrupting it with this test's leftover data.
    await waitFor(async () => {
      const disk = await getAllEntries(key);
      const editedOnDisk = disk.find((e) => e.id === editTarget.id);
      const deletedOnDisk = disk.find((e) => e.id === deleteTarget.id);
      expect(editedOnDisk?.text).toBe('edited despite future skew');
      expect(deletedOnDisk?.deleted).toBe(true);
    });
  });

  it('persists the FINAL disk value for an entry even when an older save (the user\'s own earlier edit) completes after a newer one (a concurrent merge\'s re-save), instead of letting the older write clobber it', async () => {
    const user = userEvent.setup();
    render(<App />);
    await setPinThroughUi(user);

    const captureInput = await screen.findByPlaceholderText('Jot a thought...');
    await user.type(captureInput, 'write race base');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText('write race base');

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

    // Edit WHILE the import is paused, on a snapshot taken before this edit
    // (`localEntries` was fixed at upload time, above) -- this creates
    // genuine divergence between the live entry and the stale snapshot
    // `mergeEntries` will see, so handleMerged's reconciliation below finds
    // live fresher and queues a re-save for it.
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    let input = screen.getByDisplayValue('write race base');
    await user.clear(input);
    await user.type(input, 'intermediate state');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('intermediate state');

    // Hold open the disk write carrying "intermediate state" for this
    // entry's id -- ImportBackup's own direct save of `merged` (still
    // holding the STALE pre-edit "write race base" snapshot for this id,
    // since it was captured at upload time before the edit above) writes a
    // different text and passes through untouched, so the only call this
    // matches is handleMerged's own re-save of the reconciled
    // ("intermediate state") value once the import below resolves, issued
    // BEFORE the second edit further down. Every other saveEntry call (any
    // other entry's id, or a later write for this same id) goes through
    // normally.
    const actualSaveEntry = entryRepository.saveEntry;
    let held = false;
    let resolveFirstWrite!: () => void;
    const firstWriteGate = new Promise<void>((resolve) => {
      resolveFirstWrite = resolve;
    });
    let firstWriteStarted = false;
    let firstWriteCompleted = false;
    const saveSpy = vi.spyOn(entryRepository, 'saveEntry').mockImplementation(async (k, entry) => {
      if (entry.text === 'intermediate state' && !held) {
        held = true;
        firstWriteStarted = true;
        await firstWriteGate;
        await actualSaveEntry(k, entry);
        firstWriteCompleted = true;
        return;
      }
      return actualSaveEntry(k, entry);
    });

    try {
      const { createNote } = await import('./models/entry');
      // Resolve the import with an unrelated remote note (a different id),
      // so this doesn't create a conflict for our entry -- it just leaves
      // `merged`'s seeded (stale, pre-edit) snapshot for our entry's id in
      // place, which handleMerged's reconciliation compares against live
      // state, finds live ("intermediate state") fresher, and queues a
      // re-save for -- this is the write we're holding open above, ISSUED
      // FIRST (before the second edit below).
      resolveRestore([createNote('remote import note for write race', 'device-2')]);
      await screen.findByText('remote import note for write race');
      await waitFor(() => expect(firstWriteStarted).toBe(true));

      // A second edit, issued SECOND (after the merge's re-save above was
      // already queued and is being held open), landing on the SAME entry
      // id. Committed immediately (optimistic UI) and queues its own write
      // right behind the still-pending held one. Scoped to this specific
      // entry's own Edit button, since the timeline now also shows the
      // freshly-imported "remote import note for write race" entry (also a
      // note, also with its own Edit button).
      const targetContainer = screen.getByText('intermediate state').closest('.entry') as HTMLElement;
      await user.click(within(targetContainer).getByRole('button', { name: 'Edit' }));
      input = screen.getByDisplayValue('intermediate state');
      await user.clear(input);
      await user.type(input, 'final user edit');
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await screen.findByText('final user edit');

      // Give any unsequenced, fire-and-forget write a real chance to fire
      // AND complete before we release the held write below -- with the
      // bug, the second edit's own write is unsequenced against the first
      // (held) one and would complete now, independently.
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Now let the held FIRST write -- carrying the stale
      // "intermediate state" snapshot from when it was queued, issued
      // BEFORE the second edit -- finally complete, simulating it losing
      // the disk-write race and landing after the second edit's own write.
      resolveFirstWrite();
      await waitFor(() => expect(firstWriteCompleted).toBe(true));
    } finally {
      // Always release the gate, even if an assertion above threw, so a
      // dangling held write can't leave IndexedDB mid-transaction for
      // later tests.
      resolveFirstWrite();
      saveSpy.mockRestore();
    }

    // Whatever order the underlying writes actually completed in, the
    // FINAL value persisted on disk must reflect the user's later edit --
    // not the older, stale re-save that merely happened to be released
    // last.
    expect(screen.getByText('final user edit')).toBeInTheDocument();
    const key = await deriveTestKey('1234');
    const disk = await getAllEntries(key);
    const target = disk.find(
      (e) => e.text === 'final user edit' || e.text === 'intermediate state' || e.text === 'write race base'
    );
    expect(target?.text).toBe('final user edit');
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

  it('reschedules reminders immediately when the reminder lead time is changed in Settings', async () => {
    localStorage.clear();
    const user = userEvent.setup();
    render(<App />);
    await setPinThroughUi(user);

    await waitFor(() => expect(vi.mocked(scheduleEventReminders).mock.calls.length).toBeGreaterThan(0));
    const callsBeforeChange = vi.mocked(scheduleEventReminders).mock.calls.length;

    await user.click(await screen.findByRole('button', { name: 'Settings' }));
    await user.click(await screen.findByRole('button', { name: '15 min before' }));

    await waitFor(() =>
      expect(vi.mocked(scheduleEventReminders).mock.calls.length).toBeGreaterThan(callsBeforeChange)
    );
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

  it('does not resurrect an entry that was deleted while its resolve save was still in flight, in memory or on disk', async () => {
    const user = userEvent.setup();
    render(<App />);
    await setPinThroughUi(user);

    const captureInput = await screen.findByPlaceholderText('Jot a thought...');
    await user.type(captureInput, 'resolve vs delete base');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText('resolve vs delete base');

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

    // Edit while the import is paused, then resolve it with a genuinely
    // conflicting remote version of the SAME entry (same technique as the
    // "rebuilds a queued conflict pair's local side" test above), so a real
    // ConflictPair gets queued for this id.
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const input = screen.getByDisplayValue('resolve vs delete base');
    await user.clear(input);
    await user.type(input, 'locally edited before conflict');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('locally edited before conflict');

    const remote = {
      ...localEntry,
      text: 'remote conflicting version',
      modifiedAt: localEntry.modifiedAt + 1000,
      deviceId: 'device-2',
    };
    resolveRestore([remote]);

    const thisDeviceButton = await screen.findByRole('button', {
      name: /This device's version: locally edited before conflict/,
    });

    // Hold open the resolve's own save (matched by its content, the first
    // such call from here on) so handleResolve is still awaiting it when we
    // delete the same entry below -- every other saveEntry call (the
    // delete's own queued write, and its corrective re-save) goes through
    // normally.
    const actualSaveEntry = entryRepository.saveEntry;
    let held = false;
    let resolveSaveCompleted = false;
    let releaseResolveSave!: () => void;
    const resolveSaveGate = new Promise<void>((resolve) => {
      releaseResolveSave = resolve;
    });
    const saveSpy = vi.spyOn(entryRepository, 'saveEntry').mockImplementation(async (k, entry) => {
      if (entry.text === 'locally edited before conflict' && !held) {
        held = true;
        await resolveSaveGate;
        await actualSaveEntry(k, entry);
        resolveSaveCompleted = true;
        return;
      }
      return actualSaveEntry(k, entry);
    });

    try {
      // Click resolve -- this stamps `resolved.modifiedAt = Date.now()`
      // synchronously and fires its own save, which is now held open.
      await user.click(thisDeviceButton);

      // While that save is still in flight, delete the entry from the
      // timeline (still visible/editable while the conflict was pending).
      // This delete happens strictly AFTER the resolve's own modifiedAt was
      // stamped, so it is a genuinely more recent change -- a real race,
      // not something that simply happened earlier.
      await user.click(await screen.findByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(screen.queryByText('locally edited before conflict')).not.toBeInTheDocument());

      // Now let the resolve's held save finally complete.
      releaseResolveSave();
      await waitFor(() => expect(resolveSaveCompleted).toBe(true));
      // Give handleResolve's continuation (reconciliation + commit, which
      // runs after its own save resolves) a real chance to run and
      // potentially resurrect the delete, if it's going to.
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      // Always release the gate, even if an assertion above threw, so a
      // dangling held write can't leave IndexedDB mid-transaction for
      // later tests.
      releaseResolveSave();
      saveSpy.mockRestore();
    }

    // The delete happened after the resolve decision was made (during its
    // own in-flight save), so it must win -- the entry must stay deleted,
    // not be resurrected by the resolve's save landing after it, in memory
    // or on disk. The conflict itself must still be gone either way (the
    // user did make a decision), so the resolver should not reappear.
    expect(screen.queryByText('locally edited before conflict')).not.toBeInTheDocument();
    expect(screen.queryByText('Conflicting changes')).not.toBeInTheDocument();

    const disk = await getAllEntries(key);
    const target = disk.find((e) => e.id === localEntry.id);
    expect(target?.deleted).toBe(true);
  });

  it('does not let a future clock-skewed live entry silently discard the user\'s deliberate resolve choice', async () => {
    const user = userEvent.setup();
    render(<App />);
    await setPinThroughUi(user);

    const captureInput = await screen.findByPlaceholderText('Jot a thought...');
    await user.type(captureInput, 'resolve skew base');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText('resolve skew base');

    const key = await deriveTestKey('1234');
    const [localEntry] = await getAllEntries(key);

    // First, simulate this entry having been synced from a peer whose clock
    // runs ten years ahead of this device's -- content-identical, so this
    // is an uncontested auto-merge (not a conflict); it just pushes the
    // LIVE modifiedAt for this id far into this device's future.
    const tenYearsMs = 10 * 365 * 24 * 60 * 60 * 1000;
    vi.mocked(restoreBackup).mockClear();
    vi.mocked(restoreBackup).mockResolvedValueOnce([{ ...localEntry, modifiedAt: localEntry.modifiedAt + tenYearsMs }]);

    await user.click(await screen.findByRole('button', { name: 'Settings' }));
    await user.type(screen.getByPlaceholderText('PIN or passphrase used for this backup'), 'irrelevant-secret');
    let file = new File([JSON.stringify({ version: 1, salt: 'x', ciphertext: 'y' })], 'backup.json', {
      type: 'application/json',
    });
    await user.upload(screen.getByLabelText('backup file'), file);
    await waitFor(async () => {
      const disk = await getAllEntries(key);
      expect(disk.find((e) => e.id === localEntry.id)?.modifiedAt).toBeGreaterThan(Date.now());
    });
    expect(screen.queryByText('Conflicting changes')).not.toBeInTheDocument();

    // Now a genuine conflict arrives for the SAME entry: different content,
    // an ordinary (non-skewed) modifiedAt. The live/local side of this
    // conflict pair is the future-skewed entry from above.
    vi.mocked(restoreBackup).mockResolvedValueOnce([
      { ...localEntry, text: 'remote conflicting version', tags: [], modifiedAt: Date.now(), deviceId: 'device-2' },
    ]);
    file = new File([JSON.stringify({ version: 1, salt: 'x', ciphertext: 'y' })], 'backup2.json', {
      type: 'application/json',
    });
    await user.upload(screen.getByLabelText('backup file'), file);

    const remoteButton = await screen.findByRole('button', {
      name: /Other device's version: remote conflicting version/,
    });

    // Pick the REMOTE side -- an ordinary, non-skewed modifiedAt, which is
    // "behind" the currently-live (skewed) local entry's modifiedAt. This
    // is exactly the scenario the bug describes: the version the user
    // picks is timestamp-behind the OTHER, unpicked, still-live version
    // purely due to clock skew.
    await user.click(remoteButton);

    // The user's explicit choice must win -- not be silently discarded
    // because it lost a timestamp comparison against clock skew.
    expect(await screen.findByText('remote conflicting version')).toBeInTheDocument();
    expect(screen.queryByText('resolve skew base')).not.toBeInTheDocument();
    expect(screen.queryByText('Conflicting changes')).not.toBeInTheDocument();

    // `handleResolve`'s own `await saveEntry(...)` guarantees `resolved` is
    // on disk by the time it commits -- but `reconcileAndCommitEntry` also
    // fires a further `queueEntrySave` unconditionally (fire-and-forget,
    // not awaited here), so wait for disk to reflect the final value rather
    // than assuming that second write already landed. See the Edit/Delete
    // skew test above for why leaving this un-awaited also risks a
    // dangling write corrupting a later test's freshly reset db.
    await waitFor(async () => {
      const disk = await getAllEntries(key);
      const target = disk.find((e) => e.id === localEntry.id);
      expect(target?.text).toBe('remote conflicting version');
    });
  });

  it('still lets a genuinely later concurrent change win over a resolve choice, even with the clock-skew fix that keeps resolve from losing to mere skew', async () => {
    const user = userEvent.setup();
    render(<App />);
    await setPinThroughUi(user);

    const captureInput = await screen.findByPlaceholderText('Jot a thought...');
    await user.type(captureInput, 'resolve genuine race base');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText('resolve genuine race base');

    const key = await deriveTestKey('1234');
    const [localEntry] = await getAllEntries(key);

    // Skew the live entry into the future, same technique as above.
    const skew1 = 10 * 365 * 24 * 60 * 60 * 1000; // ~10 years
    vi.mocked(restoreBackup).mockClear();
    vi.mocked(restoreBackup).mockResolvedValueOnce([{ ...localEntry, modifiedAt: localEntry.modifiedAt + skew1 }]);
    await user.click(await screen.findByRole('button', { name: 'Settings' }));
    await user.type(screen.getByPlaceholderText('PIN or passphrase used for this backup'), 'irrelevant-secret');
    let file = new File([JSON.stringify({ version: 1, salt: 'x', ciphertext: 'y' })], 'backup.json', {
      type: 'application/json',
    });
    await user.upload(screen.getByLabelText('backup file'), file);
    await waitFor(async () => {
      const disk = await getAllEntries(key);
      expect(disk.find((e) => e.id === localEntry.id)?.modifiedAt).toBeGreaterThan(Date.now());
    });

    // A genuine conflict, ordinary-timestamp remote side.
    vi.mocked(restoreBackup).mockResolvedValueOnce([
      { ...localEntry, text: 'remote pick', tags: [], modifiedAt: Date.now(), deviceId: 'device-2' },
    ]);
    file = new File([JSON.stringify({ version: 1, salt: 'x', ciphertext: 'y' })], 'backup2.json', {
      type: 'application/json',
    });
    await user.upload(screen.getByLabelText('backup file'), file);
    const remoteButton = await screen.findByRole('button', { name: /Other device's version: remote pick/ });

    // Hold open the resolve's own save so a genuinely later concurrent
    // write can land while it's in flight.
    const actualSaveEntry = entryRepository.saveEntry;
    let held = false;
    let resolveSaveCompleted = false;
    let releaseResolveSave!: () => void;
    const resolveSaveGate = new Promise<void>((resolve) => {
      releaseResolveSave = resolve;
    });
    const saveSpy = vi.spyOn(entryRepository, 'saveEntry').mockImplementation(async (k, entry) => {
      if (entry.text === 'remote pick' && !held) {
        held = true;
        await resolveSaveGate;
        await actualSaveEntry(k, entry);
        resolveSaveCompleted = true;
        return;
      }
      return actualSaveEntry(k, entry);
    });

    try {
      await user.click(remoteButton);

      // While the resolve's save is held open, land a GENUINELY later
      // change on the same id -- content-identical to what's currently
      // live (still the skewed original, since the resolve hasn't
      // committed its pick yet) but with an even later modifiedAt
      // (skew1 + 2000 > skew1), simulating another sync arriving
      // mid-flight. Both timestamps are explicit constants under the
      // test's control, so this is a deterministic race, not a
      // wall-clock timing guess.
      vi.mocked(restoreBackup).mockResolvedValueOnce([
        { ...localEntry, modifiedAt: localEntry.modifiedAt + skew1 + 2000 },
      ]);
      file = new File([JSON.stringify({ version: 1, salt: 'x', ciphertext: 'y' })], 'backup3.json', {
        type: 'application/json',
      });
      await user.upload(screen.getByLabelText('backup file'), file);
      await waitFor(async () => {
        const disk = await getAllEntries(key);
        expect(disk.find((e) => e.id === localEntry.id)?.modifiedAt).toBe(localEntry.modifiedAt + skew1 + 2000);
      });

      releaseResolveSave();
      await waitFor(() => expect(resolveSaveCompleted).toBe(true));
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      releaseResolveSave();
      saveSpy.mockRestore();
    }

    // The genuinely later change must win -- the resolve's pick must NOT
    // clobber it, in memory or on disk.
    expect(screen.queryByText('remote pick')).not.toBeInTheDocument();
    expect(screen.getByText('resolve genuine race base')).toBeInTheDocument();
    await waitFor(async () => {
      const disk = await getAllEntries(key);
      const target = disk.find((e) => e.id === localEntry.id);
      expect(target?.modifiedAt).toBe(localEntry.modifiedAt + skew1 + 2000);
      expect(target?.text).toBe('resolve genuine race base');
    });
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

  it('dequeues the correct conflict by identity when two resolve calls overlap, instead of whichever conflict is currently first in the array', async () => {
    const key = await setupPin('1234');
    const { setPendingConflicts } = await import('./sync/conflictStore');
    const { createNote } = await import('./models/entry');
    const local1 = createNote('local version 1', 'device-1');
    const remote1 = createNote('remote version 1', 'device-2');
    const local2 = createNote('local version 2', 'device-1');
    const remote2 = createNote('remote version 2', 'device-2');
    await setPendingConflicts(key, [
      { local: local1, remote: remote1 },
      { local: local2, remote: remote2 },
    ]);

    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByPlaceholderText('PIN'), '1234');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));

    await screen.findByText(/local version 1/);
    const thisDeviceButton = screen.getByRole('button', { name: /This device's version/ });

    // Delay saveEntry with a single shared, not-yet-resolved promise. Both
    // overlapping clicks below will each await THIS SAME promise instance,
    // so resolving it once lets both handleResolve continuations proceed --
    // simulating a double-click on the resolver's button before the first
    // click's save has completed (ConflictResolver has no in-flight/disabled
    // state to prevent this).
    let resolveSave!: () => void;
    const hangingSave = new Promise<void>((resolve) => {
      resolveSave = () => resolve();
    });
    const saveSpy = vi.spyOn(entryRepository, 'saveEntry').mockImplementation(() => hangingSave);

    // Two overlapping resolve calls for the SAME (first) conflict pair,
    // fired without awaiting in between so both are in flight together.
    fireEvent.click(thisDeviceButton);
    fireEvent.click(thisDeviceButton);

    resolveSave();

    // Both overlapping calls resolve conflict 1, so its resolver button is
    // gone either way -- resolved conflict 1 also legitimately reappears as
    // a normal timeline entry once resolved, so check specifically for the
    // resolver's button (not just the text anywhere in the document).
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /This device's version: local version 1/ })
      ).not.toBeInTheDocument()
    );

    saveSpy.mockRestore();

    // The second, completely unrelated conflict must still be queued --
    // the second overlapping resolve call must not have dequeued whatever
    // happened to be first in the array at that moment (which, by then, was
    // conflict 2) instead of the conflict it actually resolved (conflict 1).
    const conflict2Button = await screen.findByRole('button', {
      name: /This device's version: local version 2/,
    });
    expect(conflict2Button).toBeInTheDocument();

    // And it must still be genuinely resolvable, not a dangling duplicate.
    await user.click(conflict2Button);
    await waitFor(() => expect(screen.queryByText('Conflicting changes')).not.toBeInTheDocument());
  });

  it('does not wipe a note captured while the initial entries load is still pending, once the load resolves', async () => {
    const user = userEvent.setup();
    let resolveEntries!: (entries: Entry[]) => void;
    const spy = vi
      .spyOn(entryRepository, 'getAllEntries')
      .mockImplementationOnce(() => new Promise<Entry[]>((resolve) => (resolveEntries = resolve)));

    render(<App />);
    await setPinThroughUi(user);

    await waitFor(() => expect(spy).toHaveBeenCalled());

    const captureInput = await screen.findByPlaceholderText('Jot a thought...');
    await user.type(captureInput, 'captured during initial load');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText('captured during initial load');

    // Let the (previously hung) initial load land with an empty snapshot --
    // a plain `setEntries(loadedEntries)` here would wipe out the capture
    // that happened while it was still pending.
    resolveEntries([]);

    // Give the load-effect's setEntries call plenty of real wall-clock time
    // to land and potentially wipe the capture, if it's going to.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(screen.getByText('captured during initial load')).toBeInTheDocument();

    spy.mockRestore();
  });

  it('does not drop a conflict added locally (e.g. via import) while the initial entries/conflicts load is still pending, once the load resolves', async () => {
    const user = userEvent.setup();
    let resolveEntries!: (entries: Entry[]) => void;
    const spy = vi
      .spyOn(entryRepository, 'getAllEntries')
      .mockImplementationOnce(() => new Promise<Entry[]>((resolve) => (resolveEntries = resolve)));

    render(<App />);
    await setPinThroughUi(user);
    await waitFor(() => expect(spy).toHaveBeenCalled());

    const captureInput = await screen.findByPlaceholderText('Jot a thought...');
    await user.type(captureInput, 'shared entry during load');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText('shared entry during load');

    // getAllEntries's mockImplementationOnce was already consumed by the
    // app's own initial-load call above, so this manual call falls through
    // to the real implementation and reads the entry actually on disk.
    const key = await deriveTestKey('1234');
    const disk = await getAllEntries(key);
    const localEntry = disk.find((e) => e.text === 'shared entry during load')!;
    const conflictingRemote = {
      ...localEntry,
      text: 'remote conflict during load',
      modifiedAt: localEntry.modifiedAt + 1000,
      deviceId: 'device-2',
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

    // The import's merge runs independently of the still-pending initial
    // load, and queues a fresh conflict for this entry right away.
    await screen.findByText(/remote conflict during load/);

    // Now let the (previously hung) initial load land. Its own
    // getPendingConflicts read happened against a disk that has nothing
    // persisted yet (the persistence effect is still gated on
    // conflictsLoaded, which this load is about to flip), so a plain
    // `setConflicts(loadedConflicts)` here would wipe out the conflict that
    // was just queued in memory by the import above.
    resolveEntries([]);

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(screen.getByText(/remote conflict during load/)).toBeInTheDocument();

    spy.mockRestore();
  });

  it('surfaces a visible error if persisting pending conflicts to disk fails, instead of silently swallowing it', async () => {
    const key = await setupPin('1234');
    const { setPendingConflicts } = await import('./sync/conflictStore');
    const { createNote } = await import('./models/entry');
    const local = createNote('local version for persist failure test', 'device-1');
    const remote = createNote('remote version for persist failure test', 'device-2');
    await setPendingConflicts(key, [{ local, remote }]);

    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByPlaceholderText('PIN'), '1234');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));

    await screen.findByText(/local version for persist failure test/);

    // Only now (after the initial load has landed and conflictsLoaded is
    // true) make the persistence write itself fail, so we're specifically
    // exercising the persistence effect's own error handling.
    const persistSpy = vi.spyOn(conflictStore, 'setPendingConflicts').mockRejectedValueOnce(new Error('disk full'));
    try {
      await user.click(screen.getByText(/local version for persist failure test/));

      expect(await screen.findByText(/could not save.*pending conflict|could not save.*disk/i)).toBeInTheDocument();
    } finally {
      persistSpy.mockRestore();
    }
  });

  it('persists the FINAL conflicts state to disk even when an older write completes after a newer one, instead of letting the older write clobber it', async () => {
    const key = await setupPin('1234');
    const { setPendingConflicts: realSetPendingConflicts, getPendingConflicts } = await import('./sync/conflictStore');
    const { createNote } = await import('./models/entry');
    const localA = createNote('conflict A local', 'device-1');
    const remoteA = createNote('conflict A remote', 'device-2');
    const localB = createNote('conflict B local', 'device-1');
    const remoteB = createNote('conflict B remote', 'device-2');
    await realSetPendingConflicts(key, [
      { local: localA, remote: remoteA },
      { local: localB, remote: remoteB },
    ]);

    // Wrap (not replace) the real implementation so every write still
    // actually lands on disk -- we only want to control the RELATIVE TIMING
    // of when each write's underlying encrypt+setMeta work finishes, to
    // simulate WebCrypto's lack of ordering guarantee between two in-flight
    // encrypt() calls.
    const calls: ConflictPair[][] = [];
    let completedCount = 0;
    let releaseSecondWrite!: () => void;
    const secondWriteGate = new Promise<void>((resolve) => {
      releaseSecondWrite = resolve;
    });
    const persistSpy = vi.spyOn(conflictStore, 'setPendingConflicts').mockImplementation(async (k, c) => {
      const callNumber = calls.length + 1;
      calls.push(c);
      // The SECOND call to setPendingConflicts (the write triggered by
      // resolving conflict A below) is held open here, so it doesn't
      // complete until we release it further down -- deliberately AFTER
      // the third call (resolving conflict B) has already completed and
      // written its value to disk.
      if (callNumber === 2) {
        await secondWriteGate;
      }
      await realSetPendingConflicts(k, c);
      completedCount += 1;
    });

    try {
      const user = userEvent.setup();
      render(<App />);
      await user.type(await screen.findByPlaceholderText('PIN'), '1234');
      await user.click(screen.getByRole('button', { name: 'Unlock' }));
      await screen.findByText(/conflict A local/);

      // Let the initial load-triggered persistence write (a same-value,
      // effectively no-op write of the two pairs just loaded back in) fully
      // complete before we start controlling ordering below.
      await waitFor(() => expect(completedCount).toBe(1));

      // Resolve conflict A. In memory this immediately (and correctly --
      // prior rounds already fixed this) commits conflicts down to just
      // [pairB], and kicks off this effect's disk write for that value
      // (call #2 above), which we're holding open.
      const resolveAButton = screen.getByRole('button', { name: /This device's version: conflict A local/ });
      await user.click(resolveAButton);
      await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(2));

      // Resolve conflict B immediately after, in quick succession -- before
      // call #2's write above has completed. In memory this commits
      // conflicts down to [] right away.
      const resolveBButton = await screen.findByRole('button', { name: /This device's version: conflict B local/ });
      await user.click(resolveBButton);

      // Give any unsequenced, fire-and-forget write a real chance to fire
      // AND complete before we release the gate below -- with the bug,
      // resolving B fires an independent write immediately (unsequenced
      // against call #2), so it would complete now while call #2 is still
      // gated.
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Now let the gated call #2 (carrying the stale conflicts=[pairB]
      // snapshot from when it was queued) finally complete -- simulating it
      // losing the disk-write race and landing after the newer write.
      releaseSecondWrite();
      await waitFor(() => expect(completedCount).toBe(3));

      // Whatever order the writes actually completed in, the FINAL value
      // persisted on disk must reflect the fully-resolved (empty) conflicts
      // state -- not whichever write happened to complete last in real
      // time. With the unsequenced bug, call #2's stale [pairB] snapshot
      // completes last and overwrites the correct empty state that call #3
      // already wrote; with writes serialized and each one reading the
      // latest conflicts at the time it actually runs, call #3 only ever
      // runs (with the up-to-date value) after call #2 has fully finished.
      const finalDisk = await getPendingConflicts(key);
      expect(finalDisk).toEqual([]);
    } finally {
      persistSpy.mockRestore();
    }
  });

  it('does not clear a pending conflictError when an unrelated new conflict for a different entry id arrives (the over-broad "clear on ANY new conflict" behavior would be wrong here)', async () => {
    const key = await setupPin('1234');
    const { setPendingConflicts } = await import('./sync/conflictStore');
    const { createNote } = await import('./models/entry');
    const local1 = createNote('local version for bug6', 'device-1');
    const remote1 = createNote('remote version for bug6', 'device-2');
    await setPendingConflicts(key, [{ local: local1, remote: remote1 }]);

    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByPlaceholderText('PIN'), '1234');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));

    const saveSpy = vi.spyOn(entryRepository, 'saveEntry').mockRejectedValueOnce(new Error('disk full'));
    try {
      await user.click(await screen.findByText(/local version for bug6/));
      expect(await screen.findByText(/could not save your chosen version/i)).toBeInTheDocument();
    } finally {
      saveSpy.mockRestore();
    }

    // conflict1 is still queued (the resolve failed) and still first.
    expect(screen.getByText(/local version for bug6/)).toBeInTheDocument();

    // Capture an unrelated note and bring in a genuinely conflicting import
    // for it -- a fresh conflict for a DIFFERENT entry id than the one the
    // pending error concerns.
    const captureInput = await screen.findByPlaceholderText('Jot a thought...');
    await user.type(captureInput, 'unrelated note for bug6');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText('unrelated note for bug6');

    const entryKey = await deriveTestKey('1234');
    const allEntries = await getAllEntries(entryKey);
    const unrelatedEntry = allEntries.find((e) => e.text === 'unrelated note for bug6')!;
    const conflictingRemote = {
      ...unrelatedEntry,
      text: 'unrelated remote conflict for bug6',
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
    await screen.findByText('unrelated note for bug6');

    // Give handleMerged's setConflicts call a moment to land.
    await waitFor(() => expect(vi.mocked(restoreBackup)).toHaveBeenCalled());

    // conflict1 (with its still-pending error) must remain first and the
    // error must still be shown -- an over-broad "clear on ANY new
    // conflict" implementation would have wrongly cleared it here, even
    // though the new conflict is for an entirely unrelated entry.
    expect(screen.getByText(/local version for bug6/)).toBeInTheDocument();
    expect(screen.getByText(/could not save your chosen version/i)).toBeInTheDocument();

    // Resolve conflict1 now (the real save succeeds this time), and confirm
    // the second, previously-hidden conflict surfaces next -- proving it
    // really was queued behind conflict1, not simply absent. (The resolved
    // conflict1 text legitimately reappears in the main timeline once
    // resolved, so check for the next conflict's arrival rather than
    // conflict1's text disappearing.)
    await user.click(screen.getByText(/local version for bug6/));
    expect(await screen.findByText(/unrelated remote conflict for bug6/)).toBeInTheDocument();
  });

  it('does not resurrect a conflict that was already resolved locally while the initial entries/conflicts load is still pending', async () => {
    const user = userEvent.setup();

    // Hang BOTH the initial entries load and the initial pending-conflicts
    // load (independently controllable), so we can decide exactly what
    // each contributes and exactly when the combined load's `.then`
    // fires -- letting us resolve a conflict locally while that load is
    // still in flight, then land the load afterward with a snapshot that
    // (as if it had also been pending from a previous session, before
    // ever being resolved this session) still contains a pending conflict
    // for the very same entry id.
    let resolveEntries!: (entries: Entry[]) => void;
    const entriesSpy = vi
      .spyOn(entryRepository, 'getAllEntries')
      .mockImplementationOnce(() => new Promise<Entry[]>((resolve) => (resolveEntries = resolve)));
    let resolvePendingConflicts!: (conflicts: ConflictPair[]) => void;
    const conflictsSpy = vi
      .spyOn(conflictStore, 'getPendingConflicts')
      .mockImplementationOnce(() => new Promise<ConflictPair[]>((resolve) => (resolvePendingConflicts = resolve)));

    render(<App />);
    await setPinThroughUi(user);
    await waitFor(() => expect(entriesSpy).toHaveBeenCalled());
    expect(conflictsSpy).toHaveBeenCalled();

    // Capture a note this session -- it's immediately live in `entries`
    // (independent of the still-pending initial load), so a merge can
    // detect a genuine conflict against it.
    const captureInput = await screen.findByPlaceholderText('Jot a thought...');
    await user.type(captureInput, 'resurrection test entry');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText('resurrection test entry');

    // getAllEntries's mockImplementationOnce was already consumed by the
    // app's own initial-load call above, so this manual call falls
    // through to the real implementation and reads what's actually on
    // disk.
    const key = await deriveTestKey('1234');
    const disk = await getAllEntries(key);
    const localEntry = disk.find((e) => e.text === 'resurrection test entry')!;

    const remote = {
      ...localEntry,
      text: 'remote conflicting version for resurrection test',
      modifiedAt: localEntry.modifiedAt + 1000,
      deviceId: 'device-2',
    };
    vi.mocked(restoreBackup).mockClear();
    vi.mocked(restoreBackup).mockResolvedValueOnce([remote]);

    await user.click(await screen.findByRole('button', { name: 'Settings' }));
    await user.type(screen.getByPlaceholderText('PIN or passphrase used for this backup'), 'irrelevant-secret');
    const file = new File(
      [JSON.stringify({ version: 1, salt: 'x', ciphertext: 'y' })],
      'backup.json',
      { type: 'application/json' }
    );
    await user.upload(screen.getByLabelText('backup file'), file);

    // This import's merge runs independently of the still-pending initial
    // load, and queues a real conflict for this entry right away.
    await screen.findByText('Conflicting changes');

    // Resolve it right now, WHILE the initial load is still pending.
    const thisDeviceButton = screen.getByRole('button', { name: /This device's version/ });
    await user.click(thisDeviceButton);
    await waitFor(() => expect(screen.queryByText('Conflicting changes')).not.toBeInTheDocument());

    // Now let the previously-hung initial load land. Without
    // resolvedConflictIdsRef, the load's dedup logic (which only checks
    // "already present in *live* conflicts") would see the now-empty live
    // conflicts list and wrongly re-add this stale pair, popping the
    // resolver back open for a conflict the user just resolved.
    resolvePendingConflicts([{ local: localEntry, remote }]);
    resolveEntries([]);

    // Give the load's `.then` plenty of real wall-clock time to land and
    // potentially resurrect the resolved conflict, if it's going to.
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(screen.queryByText('Conflicting changes')).not.toBeInTheDocument();
    expect(screen.queryByText(/remote conflicting version for resurrection test/)).not.toBeInTheDocument();

    entriesSpy.mockRestore();
    conflictsSpy.mockRestore();
  });

  it('clears a stale mergeSaveError banner as soon as a fresh merge attempt begins, even if that merge does not itself fail', async () => {
    const user = userEvent.setup();
    render(<App />);
    await setPinThroughUi(user);

    const captureInput = await screen.findByPlaceholderText('Jot a thought...');
    await user.type(captureInput, 'entry for merge error clear test');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText('entry for merge error clear test');

    vi.mocked(restoreBackup).mockClear();
    let resolveRestore!: (entries: Entry[]) => void;
    vi.mocked(restoreBackup).mockImplementationOnce(
      () => new Promise<Entry[]>((resolve) => (resolveRestore = resolve))
    );

    await user.click(await screen.findByRole('button', { name: 'Settings' }));
    await user.type(screen.getByPlaceholderText('PIN or passphrase used for this backup'), 'irrelevant-secret');

    const file1 = new File(
      [JSON.stringify({ version: 1, salt: 'x', ciphertext: 'y' })],
      'backup1.json',
      { type: 'application/json' }
    );
    await user.upload(screen.getByLabelText('backup file'), file1);
    await waitFor(() => expect(restoreBackup).toHaveBeenCalled());

    // Edit while the import is paused, so handleMerged's reconciliation
    // will need to re-save this entry (the live edit wins over the stale
    // snapshot ImportBackup already wrote to disk) -- same setup as the
    // existing re-save-failure test, used here just to get a mergeSaveError
    // banner showing.
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const input = screen.getByDisplayValue('entry for merge error clear test');
    await user.clear(input);
    await user.type(input, 'edited, resave will fail');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('edited, resave will fail');

    const actualSaveEntry = entryRepository.saveEntry;
    const saveSpy = vi.spyOn(entryRepository, 'saveEntry').mockImplementation((k, entry) => {
      if (entry.text === 'edited, resave will fail') {
        return Promise.reject(new Error('disk full'));
      }
      return actualSaveEntry(k, entry);
    });

    const { createNote } = await import('./models/entry');
    try {
      resolveRestore([createNote('remote import note for merge error clear test', 'device-2')]);
      await screen.findByText(/could not save some changes to disk/i);
    } finally {
      saveSpy.mockRestore();
    }

    // A second, unrelated merge begins now. It must clear the stale error
    // the moment it starts (handleMerged calls setMergeSaveError(null) up
    // front) -- not just when/if it happens to also fail or succeed.
    vi.mocked(restoreBackup).mockResolvedValueOnce([createNote('second unrelated import', 'device-3')]);
    const file2 = new File(
      [JSON.stringify({ version: 1, salt: 'x', ciphertext: 'y' })],
      'backup2.json',
      { type: 'application/json' }
    );
    await user.upload(screen.getByLabelText('backup file'), file2);

    await screen.findByText('second unrelated import');
    expect(screen.queryByText(/could not save some changes to disk/i)).not.toBeInTheDocument();
  });

  it('dismisses the mergeSaveError banner when its Dismiss button is clicked, instead of leaving it stuck for the rest of the session', async () => {
    const key = await setupPin('1234');
    const { setPendingConflicts } = await import('./sync/conflictStore');
    const { createNote } = await import('./models/entry');
    const local = createNote('local version for dismiss test', 'device-1');
    const remote = createNote('remote version for dismiss test', 'device-2');
    await setPendingConflicts(key, [{ local, remote }]);

    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByPlaceholderText('PIN'), '1234');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));

    await screen.findByText(/local version for dismiss test/);

    const persistSpy = vi.spyOn(conflictStore, 'setPendingConflicts').mockRejectedValueOnce(new Error('disk full'));
    try {
      await user.click(screen.getByText(/local version for dismiss test/));
      await screen.findByText(/could not save.*pending conflict|could not save.*disk/i);
    } finally {
      persistSpy.mockRestore();
    }

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/could not save.*pending conflict|could not save.*disk/i)).not.toBeInTheDocument();

    // This banner previously had no dismiss control and (being fixed-
    // position, at the same top-left corner as the header) could sit on
    // top of the header's Sync/Settings buttons for the rest of the
    // session once it outlived whatever overlay triggered it. Confirm
    // dismissing it doesn't leave the header itself broken.
    expect(screen.getByRole('button', { name: 'Sync' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });

  it('resets the sync watermark so everything resends on the next sync', async () => {
    const { getLastSentAt, setLastSentAt } = await import('./storage/db');
    await setupPin('1234');
    await setLastSentAt(999999999999);

    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByPlaceholderText('PIN'), '1234');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));

    await user.click(await screen.findByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: 'Resend everything on next sync' }));

    await screen.findByText(/all your entries will be included/i);
    expect(await getLastSentAt()).toBe(0);
  });

  it('lets the user pick a theme from Settings, applying it immediately', async () => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    const user = userEvent.setup();
    render(<App />);
    await setPinThroughUi(user);

    await user.click(await screen.findByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: 'Blue' }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('blue');
    expect(localStorage.getItem('jotterpad-theme')).toBe('blue');
  });
});
