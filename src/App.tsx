import { useEffect, useRef, useState } from 'react';
import { LockScreen } from './components/LockScreen';
import { Timeline } from './components/Timeline';
import { SearchBar } from './components/SearchBar';
import { TagFilterBar } from './components/TagFilterBar';
import { SyncScreen } from './components/SyncScreen';
import { ConflictResolver } from './components/ConflictResolver';
import { ExportSettings } from './components/ExportSettings';
import { ImportBackup } from './components/ImportBackup';
import { ReminderSettings } from './components/ReminderSettings';
import { isPinConfigured } from './auth/pin';
import { getOrCreateDeviceId } from './storage/db';
import { getAllEntries, saveEntry, deleteEntry } from './storage/entryRepository';
import { getPendingConflicts, setPendingConflicts } from './sync/conflictStore';
import { createNote, createEvent, filterEntries, updateEntry, Entry } from './models/entry';
import { ConflictPair } from './sync/merge';
import { scheduleEventReminders } from './notifications/reminders';

// A last-write-wins reconciliation between the live in-memory entries (`prev`)
// and a set of entries computed from a stale snapshot (`incoming`, e.g. the
// result of a merge/import that started before `prev` picked up a local
// edit or delete). For any id present in both, whichever has the later
// modifiedAt wins -- this correctly keeps a genuinely more recent local
// edit/delete (tombstone), and correctly keeps `incoming`'s version when its
// own timestamp is newer. IDs only present in one side are always kept.
function reconcileWithLiveState(prev: Entry[], incoming: Entry[]): Entry[] {
  const incomingById = new Map(incoming.map((e) => [e.id, e]));
  const result = new Map(incomingById);
  for (const p of prev) {
    const existing = incomingById.get(p.id);
    if (!existing || p.modifiedAt > existing.modifiedAt) {
      result.set(p.id, p);
    }
  }
  return Array.from(result.values());
}

export default function App() {
  const [cryptoKey, setCryptoKey] = useState<CryptoKey | null>(null);
  const [pinConfigured, setPinConfigured] = useState<boolean | null>(null);
  const [deviceId, setDeviceId] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [conflicts, setConflicts] = useState<ConflictPair[]>([]);
  // True only once the load effect below has actually populated `conflicts`
  // from storage. Guards the persistence effect (see below) so it can never
  // fire with the initial empty `conflicts=[]` before that load has
  // resolved -- see conflictsLoaded's usage for why that matters.
  const [conflictsLoaded, setConflictsLoaded] = useState(false);
  const [conflictsDeferred, setConflictsDeferred] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [mergeSaveError, setMergeSaveError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showSync, setShowSync] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  // Always reflects the latest committed `entries` state, so handleMerged can
  // read genuinely current data (not a stale render-time closure) without
  // needing setEntries' functional-updater form -- which matters here because
  // handleMerged also needs the same "current entries" value to decide which
  // ids must be re-persisted to disk (see handleMerged below).
  const entriesRef = useRef<Entry[]>(entries);
  entriesRef.current = entries;

  // Same reasoning as entriesRef above, for `conflicts`: handleMerged needs
  // to know the id of the currently-first (displayed) conflict at the exact
  // moment it runs, not whatever `conflicts` was when the calling
  // component's render captured this closure. (A functional setConflicts
  // updater doesn't help here either -- its callback isn't guaranteed to
  // run synchronously at the call site, so a value it computes can't be read
  // back out immediately afterward.)
  const conflictsRef = useRef<ConflictPair[]>(conflicts);
  conflictsRef.current = conflicts;

  useEffect(() => {
    isPinConfigured()
      .then(setPinConfigured)
      .catch(() => setInitError('Could not check whether a PIN is set up. Please reload the app.'));
    getOrCreateDeviceId()
      .then(setDeviceId)
      .catch(() => setInitError('Could not initialize this device. Please reload the app.'));
  }, []);

  // Entries and pending conflicts load together, keyed on cryptoKey (pending
  // conflicts are encrypted, so they need the key to decrypt too -- see
  // sync/conflictStore.ts). Loading them in the same effect/Promise.all means
  // ConflictResolver never has a chance to render before entries have
  // finished loading: if it could, a user resolving a conflict during that
  // window would have their resolution reverted the moment the slower
  // getAllEntries call finally lands and overwrites `entries` wholesale.
  useEffect(() => {
    if (!cryptoKey) return;
    Promise.all([getAllEntries(cryptoKey), getPendingConflicts(cryptoKey)])
      .then(([loadedEntries, loadedConflicts]) => {
        setEntries(loadedEntries);
        setConflicts(loadedConflicts);
        setConflictsLoaded(true);
      })
      .catch(() =>
        setInitError(
          'Could not load your saved entries. Your data is still on this device untouched — please reload the app before adding anything new.'
        )
      );
  }, [cryptoKey]);

  useEffect(() => {
    scheduleEventReminders(entries);
  }, [entries]);

  // Sole writer of persisted pending conflicts: fires whenever `conflicts`
  // changes, always reflecting the latest state. This replaces scattered
  // inline setPendingConflicts calls inside state updaters (impure, and
  // prone to write-ordering races). Guarded on `conflictsLoaded` so it can
  // never fire with the initial `conflicts=[]` before the load effect above
  // has actually read persisted conflicts back in -- without this guard,
  // `cryptoKey` becoming available (synchronously, on unlock) always races
  // ahead of the async `getAllEntries`/`getPendingConflicts` load, so this
  // effect would otherwise overwrite storage with an empty array before
  // that load ever resolves (permanently losing it if the load then fails).
  useEffect(() => {
    if (!cryptoKey || !conflictsLoaded) return;
    setPendingConflicts(cryptoKey, conflicts).catch(() => {});
  }, [conflicts, cryptoKey, conflictsLoaded]);

  if (initError) return <p role="alert">{initError}</p>;
  if (pinConfigured === null) return null;
  if (!cryptoKey) {
    return <LockScreen mode={pinConfigured ? 'unlock' : 'setup'} onUnlock={setCryptoKey} />;
  }
  const key = cryptoKey;

  const nonDeleted = entries.filter((e) => !e.deleted);
  const visible = filterEntries(nonDeleted, query, selectedTags);
  const allTags = Array.from(new Set([...nonDeleted.flatMap((e) => e.tags), ...selectedTags]));

  function handleMerged(merged: Entry[], newConflicts: ConflictPair[]) {
    const prev = entriesRef.current;
    const reconciled = reconcileWithLiveState(prev, merged);
    setEntries(reconciled);

    // ImportBackup/syncActions already wrote `merged` to disk via saveEntry
    // before this callback ran (see ImportBackup.tsx / sync/syncActions.ts).
    // If `merged` was computed from a stale pre-edit/pre-delete snapshot,
    // that write left disk holding the stale version even though the live
    // local version just won reconciliation above. Re-save every entry where
    // the live version won, so disk matches memory instead of silently
    // reverting on the next load. Surface a visible error if any of these
    // re-saves fail, instead of silently swallowing it -- memory would still
    // show the correct reconciled version, but disk would stay stale with no
    // indication to the user.
    const mergedById = new Map(merged.map((e) => [e.id, e]));
    const toResave = reconciled.filter((entry) => mergedById.get(entry.id) !== entry);
    if (toResave.length > 0) {
      Promise.all(toResave.map((entry) => saveEntry(key, entry))).catch(() => {
        setMergeSaveError(
          'Could not save some changes to disk after a merge. Please reload and try again to make sure everything is saved.'
        );
      });
    }

    // Each queued conflict pair's `local` side must reflect the live entry
    // state at reconciliation time (the same `prev` used above), not the
    // stale pre-operation snapshot `mergeEntries` originally saw -- otherwise
    // resolving "this device's version" later would silently overwrite a
    // newer local edit/delete that reconciliation just rescued into
    // `reconciled`/disk, with a fresh `modifiedAt` that would make the
    // clobbered value win every future comparison too. Fall back to the
    // pair's own `local` only if that id is no longer present in live state
    // at all.
    const liveById = new Map(prev.map((e) => [e.id, e]));
    const freshConflicts = newConflicts.map((c) => ({
      ...c,
      local: liveById.get(c.local.id) ?? c.local,
    }));

    // ConflictResolver only ever shows/acts on conflicts[0], so a pending
    // conflictError (from a previously failed resolve attempt) only ever
    // pertains to that one pair. Determine whether THIS batch replaces that
    // specific pair using conflictsRef (the true current conflicts at the
    // moment handleMerged actually runs), not the `conflicts` render
    // closure -- which could be stale for the same reason `entries` needed
    // entriesRef above.
    const currentConflicts = conflictsRef.current;
    const supersedesCurrentError =
      currentConflicts.length > 0 && freshConflicts.some((nc) => nc.local.id === currentConflicts[0].local.id);

    setConflicts((prevConflicts) => {
      // A fresh conflict pair for an id supersedes any older unresolved pair
      // for that same id (e.g. from an earlier sync session) -- otherwise
      // resolving the fresh one first can be silently reverted when the
      // stale duplicate is resolved later.
      const withoutStaleDuplicates = prevConflicts.filter(
        (c) => !freshConflicts.some((nc) => nc.local.id === c.local.id)
      );
      return [...withoutStaleDuplicates, ...freshConflicts];
    });
    if (freshConflicts.length > 0) {
      // Give a freshly-arrived conflict a chance to prompt even if an
      // earlier batch was deferred.
      setConflictsDeferred(false);
    }
    if (supersedesCurrentError) {
      // The pair a stale conflictError was about has just been replaced --
      // drop the error so it doesn't linger and confuse the user about the
      // fresh pair that replaced it.
      setConflictError(null);
    }
  }

  async function handleResolve(entry: Entry) {
    const resolved = { ...entry, modifiedAt: Date.now() };
    try {
      await saveEntry(key, resolved);
    } catch {
      setConflictError('Could not save your chosen version. Please try again.');
      return;
    }
    setEntries((prev) => [...prev.filter((e) => e.id !== resolved.id), resolved]);
    setConflicts((prev) => prev.slice(1));
    setConflictError(null);
  }

  async function handleAddNote(rawText: string) {
    const entry = createNote(rawText, deviceId);
    await saveEntry(key, entry);
    setEntries((prev) => [...prev, entry]);
  }

  async function handleAddEvent(rawText: string, eventDate: string, eventTime: string) {
    const entry = createEvent(rawText, eventDate, eventTime, deviceId);
    await saveEntry(key, entry);
    setEntries((prev) => [...prev, entry]);
  }

  async function handleDelete(id: string) {
    const updated = await deleteEntry(key, entries, id);
    const tombstoned = updated.find((e) => e.id === id);
    setEntries((prev) => (tombstoned ? prev.map((e) => (e.id === id ? tombstoned : e)) : prev));
  }

  async function handleEdit(id: string, rawText: string, eventDate?: string, eventTime?: string) {
    const existing = entries.find((e) => e.id === id);
    if (!existing) return;
    const updated = updateEntry(existing, rawText, deviceId, eventDate, eventTime);
    await saveEntry(key, updated);
    setEntries((prev) => prev.map((e) => (e.id === id ? updated : e)));
  }

  return (
    <div className="app">
      <header>
        <h1>Jotterpad</h1>
        <button onClick={() => setShowSync(true)}>Sync</button>
        <button onClick={() => setShowSettings(true)}>Settings</button>
      </header>
      <SearchBar value={query} onChange={setQuery} />
      <TagFilterBar
        tags={allTags}
        selected={selectedTags}
        onToggle={(tag) =>
          setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]))
        }
      />
      <Timeline
        entries={visible}
        onAddNote={handleAddNote}
        onAddEvent={handleAddEvent}
        onDelete={handleDelete}
        onEdit={handleEdit}
      />
      {showSync && (
        <SyncScreen
          entries={entries}
          deviceId={deviceId}
          cryptoKey={cryptoKey}
          onMerged={handleMerged}
          onClose={() => setShowSync(false)}
        />
      )}
      {showSettings && (
        <div className="settings">
          <ExportSettings entries={entries} />
          <ImportBackup cryptoKey={cryptoKey} localEntries={entries} onImported={handleMerged} />
          <ReminderSettings />
          <button onClick={() => setShowSettings(false)}>Close</button>
        </div>
      )}
      {mergeSaveError && <p role="alert">{mergeSaveError}</p>}
      {conflicts.length > 0 && !conflictsDeferred && (
        <ConflictResolver
          conflicts={conflicts}
          onResolve={handleResolve}
          onDefer={() => {
            setConflictsDeferred(true);
            // Don't let a stale error from a previous resolve attempt linger
            // once the user has stepped away from it -- it would otherwise
            // still be showing (confusingly attached to a different pair)
            // the next time the resolver reappears for a fresh conflict.
            setConflictError(null);
          }}
          error={conflictError}
        />
      )}
    </div>
  );
}
