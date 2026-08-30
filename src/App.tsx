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
import { ThemeSettings } from './components/ThemeSettings';
import { isPinConfigured } from './auth/pin';
import { getOrCreateDeviceId, setLastSentAt } from './storage/db';
import { getAllEntries, saveEntry } from './storage/entryRepository';
import { getPendingConflicts, setPendingConflicts } from './sync/conflictStore';
import { createNote, createEvent, filterEntries, updateEntry, markDeleted, Entry } from './models/entry';
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
  const [resendConfirmed, setResendConfirmed] = useState(false);

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
  // Serializes every write the persistence effect below makes to disk.
  // `setPendingConflicts` internally does `encrypt` (WebCrypto, resolves off
  // a thread pool with no ordering guarantee) then `setMeta` (an IndexedDB
  // write) -- so two independently-fired writes can complete in EITHER
  // order. Without this, an older write finishing after a newer one would
  // silently overwrite the newer, correct value with stale data (see the
  // effect's own comment for how this is chained).
  const pendingConflictsWriteChainRef = useRef<Promise<void>>(Promise.resolve());
  // Same problem, generalized PER ENTRY ID: individual entries (not just the
  // pending-conflicts blob) are also written via `saveEntry`, which has the
  // identical encrypt-then-IndexedDB-write shape and therefore the identical
  // no-ordering-guarantee hazard. Two saves for the SAME entry id fired
  // independently (e.g. a sync's corrective re-save racing a user's own
  // edit-save) can complete in EITHER order -- an older write landing after
  // a newer one silently overwrites the newer, correct value on disk with no
  // error, even though in-memory state (entriesRef) is correct throughout.
  // Keyed per id (unlike the single conflicts chain above) so writes to
  // DIFFERENT entries stay independent and don't block each other -- only
  // writes to the SAME id are serialized against one another. See
  // `queueEntrySave` below for the write path that chains onto this.
  const entryWriteChainsRef = useRef<Map<string, Promise<void>>>(new Map());

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

  // Sole writer of individual entries to disk. Every place below that needs
  // to persist an entry -- `handleMerged`'s re-save loop,
  // `reconcileAndCommitEntry` (used by `handleEdit`/`handleDelete`/
  // `handleResolve`) -- calls this instead of firing its own independent
  // `saveEntry`, generalizing `pendingConflictsWriteChainRef`'s pattern to
  // per-entry-id. Chaining onto `entryWriteChainsRef`'s promise for this id
  // guarantees a write only starts once the previous write for that SAME id
  // has fully finished, so two writes for the same id can never complete out
  // of order (writes for different ids are unaffected by each other).
  // Deliberately takes only an id, not an entry object: it re-reads
  // `entriesRef.current` at the moment the write actually EXECUTES (not
  // whatever the caller captured when it queued the write), so a write
  // queued from a since-stale computation still ends up persisting whatever
  // is CURRENTLY true by the time its turn comes -- collapsing redundant or
  // stale queued writes into a single write of the final state, the same
  // way the pending-conflicts write chain above already does.
  function queueEntrySave(id: string, key: CryptoKey): Promise<void> {
    const previous = entryWriteChainsRef.current.get(id) ?? Promise.resolve();
    const next = previous
      .then(() => {
        const latest = entriesRef.current.find((e) => e.id === id);
        if (!latest) return;
        return saveEntry(key, latest);
      })
      .catch(() =>
        setMergeSaveError(
          'Could not save some changes to disk. Please reload and try again to make sure everything is saved.'
        )
      );
    entryWriteChainsRef.current.set(id, next);
    return next;
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

  // Reminders above are only rescheduled when `entries` itself changes -- but
  // an event can cross into the 24-hour reminder window purely from time
  // passing, with the app left open and untouched (no capture/edit/delete/
  // sync to trigger the effect above). Rescan hourly to catch that case too.
  // Reads `entriesRef.current` (not the `entries` closure captured when this
  // effect was set up) so each tick always reschedules against whatever is
  // CURRENTLY live, the same ref-based discipline used everywhere else in
  // this file to avoid acting on a stale render closure -- deliberately NOT
  // `[entries]` in the dependency array with a closure read of `entries`
  // inside the interval, which would tie the interval's setup/teardown to
  // entries changing instead of just to mount/unmount.
  // `scheduleEventReminders`'s own internal registry (Task 13) already makes
  // repeated calls with the same data a safe no-op re-schedule.
  useEffect(() => {
    const interval = setInterval(() => {
      scheduleEventReminders(entriesRef.current);
    }, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

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
  //
  // Every run is chained onto `pendingConflictsWriteChainRef` instead of
  // firing an independent, unsequenced write: `setPendingConflicts` does
  // `encrypt` (WebCrypto, resolves off a thread pool with no ordering
  // guarantee) then `setMeta` (IndexedDB), so two writes fired close
  // together (e.g. two resolves in quick succession, which render the
  // resolver's buttons at the same screen position for the next pair) could
  // otherwise complete in EITHER order -- if the older one lands after the
  // newer one, it silently overwrites the newer, correct value with stale
  // data (a resolved conflict can reappear on the next load, or a fresh
  // conflict's only remaining copy can be lost for good). Chaining onto the
  // ref's promise guarantees each write only starts once the previous one
  // has fully finished, so they can never complete out of order.
  //
  // Each queued write also reads `conflictsRef.current` (not the `conflicts`
  // closure captured when this effect run was scheduled) at the moment it
  // actually executes. If several changes fire this effect in a burst before
  // the chain catches up, every write still queued behind the in-flight one
  // ends up persisting whatever the LATEST value is by the time its turn
  // comes, collapsing redundant intermediate writes into a single write of
  // the final state instead of dutifully writing each stale intermediate
  // value in sequence.
  useEffect(() => {
    if (!cryptoKey || !conflictsLoaded) return;
    const keyForThisWrite = cryptoKey;
    pendingConflictsWriteChainRef.current = pendingConflictsWriteChainRef.current
      .then(() => setPendingConflicts(keyForThisWrite, conflictsRef.current))
      .catch(() =>
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
    // Route every re-save through the per-id write queue (see
    // `queueEntrySave`'s doc comment) instead of firing independent,
    // unsequenced `saveEntry` calls -- otherwise this re-save could complete
    // AFTER a concurrent write for the same id from an unrelated code path
    // (e.g. the user's own edit-save for the same entry), silently
    // overwriting it with this stale pre-merge content. Each call surfaces
    // its own failure via `queueEntrySave`'s internal catch.
    toResave.forEach((entry) => queueEntrySave(entry.id, key));

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
    // Stamp a MONOTONIC timestamp relative to what's currently live, not a
    // bare Date.now(). A bare Date.now() can lose the reconciliation below
    // to the live entry purely because of clock skew: an entry synced from
    // a peer whose clock runs ahead of this device's can carry a modifiedAt
    // in this device's future, and Date.now() -- read on THIS device, right
    // now -- is necessarily behind it. That would silently discard the
    // user's explicit, deliberate resolve choice (including permanently
    // losing the unpicked side of the conflict, which exists nowhere else)
    // for as long as the skew persists -- not a brief race window. Reading
    // the live version's modifiedAt BEFORE stamping `resolved` and taking
    // Math.max(Date.now(), liveVersionModifiedAt + 1) guarantees `resolved`
    // always wins reconciliation against whatever was live at the moment of
    // resolving, the same high-water-mark reasoning already used for
    // `markBundleSent` (see sync/syncActions.ts). Falls back to
    // `entry.modifiedAt` if this id is no longer present in live state at
    // all (e.g. it was deleted concurrently).
    const liveVersion = entriesRef.current.find((e) => e.id === entry.id);
    const liveVersionModifiedAt = liveVersion ? liveVersion.modifiedAt : entry.modifiedAt;
    const resolved = { ...entry, modifiedAt: Math.max(Date.now(), liveVersionModifiedAt + 1) };
    try {
      await saveEntry(key, resolved);
    } catch {
      setConflictError('Could not save your chosen version. Please try again.');
      return;
    }
    // Reconcile against live state instead of committing `resolved`
    // unconditionally. The entry stays visible/editable/deletable in the
    // timeline while a conflict for it is pending, and a fresh
    // sync/merge can also update it directly -- so it may have been
    // deleted or further edited by something else in the window between
    // when this conflict was queued and now. Uses the same
    // last-write-wins-by-modifiedAt rule already applied everywhere else
    // in this file (reconcileWithLiveState itself, used for
    // handleMerged/the initial load), deliberately NOT a "resolve always
    // wins" special case: `resolved`'s modifiedAt is stamped (per above) to
    // already exceed whatever was live at the moment this function started,
    // so it already wins against anything that genuinely happened before
    // this moment -- including a live entry with a clock-skewed future
    // timestamp. Reconciliation only ever overrides it when something else
    // has a STRICTLY LATER modifiedAt than that, which can only happen if
    // that other change is itself concurrent with this resolve (e.g. a
    // delete that lands during this function's own `await` above, or a
    // sync landing an even-later value) -- a genuine race, not something
    // that simply happened earlier or merely reflects clock skew -- which
    // is exactly the case that must not be silently clobbered.
    reconcileAndCommitEntry(resolved);

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
    // Not routed through queueEntrySave: a freshly generated id can't
    // possibly be the target of a concurrent write from any other code
    // path -- nothing else knows this id exists until it's committed to
    // entriesRef immediately below, so there is no same-id race to close
    // here. Kept as a direct awaited save (rather than an optimistic
    // commit-then-save) so the entry only appears once it's actually on
    // disk, preserving existing behavior.
    await saveEntry(key, entry);
    commitEntries([...entriesRef.current, entry]);
  }

  async function handleAddEvent(rawText: string, eventDate: string, eventTime: string) {
    const entry = createEvent(rawText, eventDate, eventTime, deviceId);
    // Same reasoning as handleAddNote above.
    await saveEntry(key, entry);
    commitEntries([...entriesRef.current, entry]);
  }

  // Used SOLELY by handleResolve below (handleEdit/handleDelete used to
  // route through this too -- see commitEntryDirect's comment for why they
  // no longer do). Reconciles `computed` against the LIVE ref rather than
  // committing it unconditionally, using the same reconcileWithLiveState
  // comparison handleMerged already uses for this class of race:
  // `entriesRef.current` plays the role of live state, and `[computed]`
  // plays the role of the (possibly stale) candidate, so a genuinely newer
  // live modifiedAt wins instead of being silently clobbered. This
  // reconciliation is still load-bearing for handleResolve specifically:
  // there is a genuine `await saveEntry(...)` gap between reading live
  // state (to compute `computed`'s monotonic timestamp) and this call, in
  // which a concurrent change (e.g. a delete, or another sync/merge) can
  // land for the same id -- see handleResolve's own comment for how its
  // timestamp is chosen so this reconciliation only ever loses a GENUINE
  // race, never merely to clock skew.
  //
  // Always queues a re-save of whatever this id's committed value now is
  // (not just when the live version won reconciliation) via
  // `queueEntrySave`, which re-reads `entriesRef.current` at its own
  // execution time rather than saving the `computed`/`winner` value
  // captured here -- so it always ends up persisting whatever is CURRENTLY
  // true regardless of which value won, the same "always queue, let the
  // queue collapse redundant writes" simplification the pending-conflicts
  // write chain already relies on. This also means every write for this id
  // -- including the "normal" case where `computed` simply wins outright --
  // goes through the same serialized per-id queue as any concurrent write
  // for the same id from another code path (e.g. handleMerged's re-save
  // loop), instead of being a separate, unsequenced saveEntry call that
  // could land out of order against one.
  function reconcileAndCommitEntry(computed: Entry) {
    const reconciled = reconcileWithLiveState(entriesRef.current, [computed]);
    commitEntries(reconciled);
    queueEntrySave(computed.id, key);
  }

  // Used by handleEdit/handleDelete below. Unlike reconcileAndCommitEntry
  // above (still needed by handleResolve), this commits `computed`
  // UNCONDITIONALLY -- no "is the live version newer" comparison -- because
  // for these two callers that comparison is now both unnecessary and
  // actively harmful:
  //
  // - Unnecessary: round 7 restructured handleEdit/handleDelete to be fully
  //   synchronous, with no `await` between reading entriesRef.current (to
  //   compute `existing`/`updated`/the tombstone) and this call. `computed`
  //   is therefore derived from state that is STILL current at the moment
  //   it is committed -- there is no gap left in which a genuinely
  //   concurrent write could land, so there is nothing left to reconcile
  //   against.
  // - Harmful: an entry synced from a peer whose clock runs ahead of this
  //   device's can carry a modifiedAt in this device's future. The
  //   reconciliation this replaces would then always keep the (stale,
  //   unedited) live entry over `computed` -- which is stamped with an
  //   ordinary Date.now() and therefore necessarily behind that future
  //   timestamp -- silently discarding every edit and delete on that entry
  //   for as long as the clock skew persists. That's a real, deterministic
  //   regression, not a narrow race window; see this fix's task/report for
  //   the full writeup.
  //
  // Still routes through `queueEntrySave` (not an unsequenced `saveEntry`
  // call) to keep round 7's per-id disk-write serialization intact -- that
  // part of the earlier fix is still correct and still needed; only the
  // "reject if live is newer" gate is gone.
  function commitEntryDirect(computed: Entry) {
    commitEntries(entriesRef.current.map((e) => (e.id === computed.id ? computed : e)));
    queueEntrySave(computed.id, key);
  }

  function handleDelete(id: string) {
    const existing = entriesRef.current.find((e) => e.id === id);
    if (!existing) return;
    commitEntryDirect(markDeleted(existing));
  }

  function handleEdit(id: string, rawText: string, eventDate?: string, eventTime?: string) {
    const existing = entriesRef.current.find((e) => e.id === id);
    if (!existing) return;
    const updated = updateEntry(existing, rawText, deviceId, eventDate, eventTime);
    commitEntryDirect(updated);
  }

  // Escape hatch for an interrupted sync: if "Done showing" is tapped before
  // the peer actually finished scanning (or the peer's scan failed), the
  // shown entries' modifiedAt is now at or below lastSentAt forever --
  // selectChangedSince would never include them in a future outgoing bundle
  // again, unless each one happens to be edited again. Resetting the
  // watermark to 0 makes every entry look "changed since" on the next sync.
  // Deliberately isolated from entries/conflicts state: it only touches the
  // lastSentAt value persisted in IndexedDB (via setLastSentAt) and a local
  // confirmation flag, with no read of or write to entriesRef/conflictsRef.
  async function handleResendEverything() {
    await setLastSentAt(0);
    setResendConfirmed(true);
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
          <ThemeSettings />
          <div>
            <button
              onClick={() => {
                setResendConfirmed(false);
                handleResendEverything();
              }}
            >
              Resend everything on next sync
            </button>
            <p>
              If a sync was interrupted or the other device didn't finish scanning, use this to make sure
              everything gets sent again next time.
            </p>
            {resendConfirmed && <p>Done — all your entries will be included in the next sync.</p>}
          </div>
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
