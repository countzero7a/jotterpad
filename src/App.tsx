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
import { getOrCreateDeviceId } from './storage/db';
import { getAllEntries, saveEntry, deleteEntry } from './storage/entryRepository';
import { createNote, createEvent, filterEntries, Entry } from './models/entry';
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

  useEffect(() => {
    isPinConfigured().then(setPinConfigured);
    getOrCreateDeviceId().then(setDeviceId);
  }, []);

  useEffect(() => {
    if (!cryptoKey) return;
    getAllEntries(cryptoKey).then((loaded) => {
      setEntries(loaded);
      scheduleEventReminders(loaded);
    });
  }, [cryptoKey]);

  if (pinConfigured === null) return null;
  if (!cryptoKey) {
    return <LockScreen mode={pinConfigured ? 'unlock' : 'setup'} onUnlock={setCryptoKey} />;
  }

  const visible = filterEntries(entries.filter((e) => !e.deleted), query, selectedTags);
  const allTags = Array.from(new Set(entries.flatMap((e) => e.tags)));

  function handleMerged(merged: Entry[], newConflicts: ConflictPair[]) {
    setEntries(merged);
    setConflicts((prev) => [...prev, ...newConflicts]);
  }

  async function handleResolve(entry: Entry) {
    await saveEntry(cryptoKey!, entry);
    setEntries((prev) => [...prev.filter((e) => e.id !== entry.id), entry]);
    setConflicts((prev) => prev.slice(1));
  }

  async function handleAddNote(rawText: string) {
    const entry = createNote(rawText, deviceId);
    await saveEntry(cryptoKey!, entry);
    setEntries((prev) => [...prev, entry]);
  }

  async function handleAddEvent(rawText: string, eventDate: string, eventTime: string) {
    const entry = createEvent(rawText, eventDate, eventTime, deviceId);
    await saveEntry(cryptoKey!, entry);
    setEntries((prev) => [...prev, entry]);
  }

  async function handleDelete(id: string) {
    setEntries(await deleteEntry(cryptoKey!, entries, id));
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
      />
      {conflicts.length > 0 && <ConflictResolver conflicts={conflicts} onResolve={handleResolve} />}
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
    </div>
  );
}
