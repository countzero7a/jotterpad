import { Entry } from '../models/entry';

export interface ConflictPair {
  local: Entry;
  remote: Entry;
}

export interface MergeResult {
  merged: Entry[];
  conflicts: ConflictPair[];
}

export function selectChangedSince(entries: Entry[], sinceTimestamp: number): Entry[] {
  return entries.filter((e) => e.modifiedAt > sinceTimestamp);
}

function contentEquals(a: Entry, b: Entry): boolean {
  return (
    a.type === b.type &&
    a.text === b.text &&
    a.deleted === b.deleted &&
    a.eventDate === b.eventDate &&
    a.eventTime === b.eventTime &&
    a.linkedNoteId === b.linkedNoteId &&
    JSON.stringify([...a.tags].sort()) === JSON.stringify([...b.tags].sort())
  );
}

export function mergeEntries(local: Entry[], remote: Entry[], lastSyncAt: number): MergeResult {
  const merged = new Map<string, Entry>(local.map((e) => [e.id, e]));
  const conflicts: ConflictPair[] = [];

  for (const remoteEntry of remote) {
    const localEntry = merged.get(remoteEntry.id);

    if (!localEntry) {
      merged.set(remoteEntry.id, remoteEntry);
      continue;
    }

    if (contentEquals(localEntry, remoteEntry)) {
      merged.set(remoteEntry.id, remoteEntry.modifiedAt >= localEntry.modifiedAt ? remoteEntry : localEntry);
      continue;
    }

    const localChangedSinceSync = localEntry.modifiedAt > lastSyncAt;
    const remoteChangedSinceSync = remoteEntry.modifiedAt > lastSyncAt;

    if (localChangedSinceSync && remoteChangedSinceSync) {
      conflicts.push({ local: localEntry, remote: remoteEntry });
      continue;
    }

    if (remoteChangedSinceSync && !localChangedSinceSync) {
      merged.set(remoteEntry.id, remoteEntry);
    }
  }

  return { merged: Array.from(merged.values()), conflicts };
}
