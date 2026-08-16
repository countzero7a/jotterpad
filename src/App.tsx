import { useEffect, useState } from 'react';
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
import { getOrCreateDeviceId, getPendingConflicts, setPendingConflicts } from './storage/db';
import { getAllEntries, saveEntry, deleteEntry } from './storage/entryRepository';
import { createNote, createEvent, filterEntries, updateEntry, Entry } from './models/entry';
import { ConflictPair } from './sync/merge';
import { scheduleEventReminders } from './notifications/reminders';

export default function App() {
  const [cryptoKey, setCryptoKey] = useState<CryptoKey | null>(null);
  const [pinConfigured, setPinConfigured] = useState<boolean | null>(null);
  const [deviceId, setDeviceId] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [conflicts, setConflicts] = useState<ConflictPair[]>([]);
  const [query, setQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showSync, setShowSync] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    isPinConfigured()
      .then(setPinConfigured)
      .catch(() => setInitError('Could not check whether a PIN is set up. Please reload the app.'));
    getOrCreateDeviceId()
      .then(setDeviceId)
      .catch(() => setInitError('Could not initialize this device. Please reload the app.'));
    getPendingConflicts()
      .then(setConflicts)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!cryptoKey) return;
    getAllEntries(cryptoKey)
      .then((loaded) => {
        setEntries(loaded);
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
    setEntries(merged);
    setConflicts((prev) => {
      const next = [...prev, ...newConflicts];
      setPendingConflicts(next);
      return next;
    });
  }

  async function handleResolve(entry: Entry) {
    const resolved = { ...entry, modifiedAt: Date.now() };
    await saveEntry(key, resolved);
    setEntries((prev) => [...prev.filter((e) => e.id !== resolved.id), resolved]);
    setConflicts((prev) => {
      const next = prev.slice(1);
      setPendingConflicts(next);
      return next;
    });
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
      {conflicts.length > 0 && <ConflictResolver conflicts={conflicts} onResolve={handleResolve} />}
    </div>
  );
}
