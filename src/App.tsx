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

  // `entriesRef`/`conflictsRef` are the single authoritative source of truth
  // for reconciliation logic -- they are written ONLY by `commitEntries`/
  // `commitConflicts` below (synchronously, at the same point `setEntries`/
  // `setConflicts` is called), and never by a render-time assignment. Prior
  // versions of this file assigned `entriesRef.current = entries` in the
  // component body, or wrote the ref from inside a `setEntries` functional
  // updater's callback -- both of those are timing-dependent: a render-time
  // assignment only runs on the render *after* a commit lands, and a
  // functional updater's callback is not guaranteed to run synchronously
  // when React defers it (its "eager state" optimization, which normally
  // makes functional updaters resolve synchronously, is disabled whenever
  // another update is already pending on the fiber -- a common situation
  // once several async continuations are in flight). Either gap lets
  // `entriesRef.current`/`conflictsRef.current` still be read as stale by a
  // later synchronous continuation. Routing every write through one commit
  // function each closes that gap structurally: the ref update and the
  // state update happen in the same synchronous call, with no other code
  // path able to touch the ref, so there is no window in which the ref can
  // lag behind what was actually committed.
  const entriesRef = useRef<Entry[]>([]);
  const conflictsRef = useRef<ConflictPair[]>([]);
  // Populated by handleResolve (before its commitConflicts call) with the id
  // of every entry resolved locally this session. The initial load below
  // must exclude these ids from `loadedConflicts` in addition to whatever is
  // already present in live `conflicts` -- a conflict resolved during the
  // load window is no longer present in live state (it was dequeued), so
  // without this, a slow disk read that started before the resolve would
  // otherwise resurrect it.
  const resolvedConflictIdsRef = useRef<Set<string>>(new Set());

  // Sole writers of `entries`/`conflicts`. Every other place in this
  // component that needs to change one of them must funnel through here --
  // see the ref comment above for why. `next` must always be computed from
  // `entriesRef.current`/`conflictsRef.current` (never from the `entries`/
  // `conflicts` state variables captured in a render closure, and never from
  // a functional updater's `prev` parameter), so callers below always read
  // and combine from the ref.
  function commitEntries(next: Entry[]) {
    entriesRef.current = next;
    setEntries(next);
  }
  function commitConflicts(next: ConflictPair[]) {
    conflictsRef.current = next;
    setConflicts(next);
  }

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
        // Reconcile against live state instead of overwriting wholesale --
        // the timeline/capture bar are fully interactive as soon as
        // cryptoKey is set, before this load resolves, so anything captured
        // or edited during the load window must survive the load landing
        // (see reconcileWithLiveState's own doc comment).
        commitEntries(reconcileWithLiveState(entriesRef.current, loadedEntries));

        // Same concern for conflicts: a conflict resolved or newly queued
        // (e.g. via a merge/import) during the load window must not be
        // reverted by this load landing. Merge by id: keep everything
        // already in live `conflicts` (already-queued ids), exclude any id
        // resolved locally during the load window (resolvedConflictIdsRef --
        // a local resolve already removed its id from live `conflicts`, so
        // "not currently present" alone can't distinguish "resolved, don't
        // resurrect" from "never touched, safe to load"), and only append
        // ids the load found that clear both exclusions.
        const currentConflicts = conflictsRef.current;
        const existingIds = new Set(currentConflicts.map((c) => c.local.id));
        const additions = loadedConflicts.filter(
          (c) => !existingIds.has(c.local.id) && !resolvedConflictIdsRef.current.has(c.local.id)
        );
        if (currentConflicts.length === 0) {
          commitConflicts(additions);
        } else if (additions.length > 0) {
          commitConflicts([...currentConflicts, ...additions]);
        }
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
    setPendingConflicts(cryptoKey, conflicts).catch(() =>
      setMergeSaveError(
        'Could not save pending conflict changes to disk. Please reload and try again to make sure everything is saved.'
      )
    );
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
    // A fresh merge attempt supersedes any stale error from a previous one --
    // otherwise a re-save failure banner from an earlier merge could linger
    // indefinitely, unrelated to whatever this merge does or doesn't do.
    setMergeSaveError(null);

    const prev = entriesRef.current;
    const reconciled = reconcileWithLiveState(prev, merged);
    commitEntries(reconciled);

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

    // A fresh conflict pair for an id supersedes any older unresolved pair
    // for that same id (e.g. from an earlier sync session) -- otherwise
    // resolving the fresh one first can be silently reverted when the stale
    // duplicate is resolved later.
    const withoutStaleDuplicates = currentConflicts.filter(
      (c) => !freshConflicts.some((nc) => nc.local.id === c.local.id)
    );
    commitConflicts([...withoutStaleDuplicates, ...freshConflicts]);
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
    commitEntries([...entriesRef.current.filter((e) => e.id !== resolved.id), resolved]);

    // Record this id as resolved BEFORE dequeuing it, so a still-in-flight
    // initial load (see the load effect above) can tell "resolved this
    // session, don't resurrect" apart from "never touched, safe to load".
    resolvedConflictIdsRef.current.add(resolved.id);
    // Dequeue by identity (the specific pair whose local.id matches the
    // entry just resolved), not by array position. handleResolve is async,
    // so two overlapping resolve calls (e.g. a double-click before the
    // first click's save completes -- ConflictResolver has no in-flight/
    // disabled state) would otherwise both remove whatever is CURRENTLY
    // first when each one's commitConflicts finally runs, which can
    // silently discard a completely different, still-unresolved conflict
    // pair. This is safe/idempotent given the existing dedup logic already
    // guarantees at most one pending conflict per entry id.
    commitConflicts(conflictsRef.current.filter((c) => c.local.id !== resolved.id));
    setConflictError(null);
  }

  async function handleAddNote(rawText: string) {
    const entry = createNote(rawText, deviceId);
    await saveEntry(key, entry);
    commitEntries([...entriesRef.current, entry]);
  }

  async function handleAddEvent(rawText: string, eventDate: string, eventTime: string) {
    const entry = createEvent(rawText, eventDate, eventTime, deviceId);
    await saveEntry(key, entry);
    commitEntries([...entriesRef.current, entry]);
  }

  async function handleDelete(id: string) {
    const updated = await deleteEntry(key, entriesRef.current, id);
    const tombstoned = updated.find((e) => e.id === id);
    const next = tombstoned
      ? entriesRef.current.map((e) => (e.id === id ? tombstoned : e))
      : entriesRef.current;
    commitEntries(next);
  }

  async function handleEdit(id: string, rawText: string, eventDate?: string, eventTime?: string) {
    const existing = entriesRef.current.find((e) => e.id === id);
    if (!existing) return;
    const updated = updateEntry(existing, rawText, deviceId, eventDate, eventTime);
    await saveEntry(key, updated);
    commitEntries(entriesRef.current.map((e) => (e.id === id ? updated : e)));
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
      {mergeSaveError && (
        <p role="alert" className="merge-save-error">
          {mergeSaveError}
          <button type="button" onClick={() => setMergeSaveError(null)}>
            Dismiss
          </button>
        </p>
      )}
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
