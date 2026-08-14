export type EntryType = 'note' | 'event';

export interface Entry {
  id: string;
  type: EntryType;
  text: string;
  tags: string[];
  eventDate?: string;
  eventTime?: string;
  linkedNoteId?: string;
  createdAt: number;
  modifiedAt: number;
  deviceId: string;
  deleted: boolean;
  deletedAt?: number;
}

const TAG_PATTERN = /#([a-zA-Z0-9_]+)/g;

export function parseTags(raw: string): { text: string; tags: string[] } {
  const tags = Array.from(new Set(Array.from(raw.matchAll(TAG_PATTERN), (m) => m[1].toLowerCase())));
  return { text: raw.trim(), tags };
}

export function createNote(rawText: string, deviceId: string): Entry {
  const { text, tags } = parseTags(rawText);
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    type: 'note',
    text,
    tags,
    createdAt: now,
    modifiedAt: now,
    deviceId,
    deleted: false,
  };
}

export function createEvent(
  rawText: string,
  eventDate: string,
  eventTime: string | undefined,
  deviceId: string,
  linkedNoteId?: string
): Entry {
  const { text, tags } = parseTags(rawText);
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    type: 'event',
    text,
    tags,
    eventDate,
    eventTime,
    linkedNoteId,
    createdAt: now,
    modifiedAt: now,
    deviceId,
    deleted: false,
  };
}

export function markDeleted(entry: Entry): Entry {
  return { ...entry, deleted: true, deletedAt: Date.now(), modifiedAt: Date.now() };
}

export function updateEntry(
  entry: Entry,
  rawText: string,
  deviceId: string,
  eventDate?: string,
  eventTime?: string
): Entry {
  const { text, tags } = parseTags(rawText);
  const updated: Entry = { ...entry, text, tags, modifiedAt: Date.now(), deviceId };
  if (entry.type === 'event') {
    updated.eventDate = eventDate ?? entry.eventDate;
    updated.eventTime = eventTime;
  }
  return updated;
}

export function filterEntries(entries: Entry[], query: string, selectedTags: string[]): Entry[] {
  const normalizedQuery = query.trim().toLowerCase();
  return entries.filter((entry) => {
    const matchesQuery = normalizedQuery === '' || entry.text.toLowerCase().includes(normalizedQuery);
    const matchesTags = selectedTags.length === 0 || selectedTags.every((tag) => entry.tags.includes(tag));
    return matchesQuery && matchesTags;
  });
}
