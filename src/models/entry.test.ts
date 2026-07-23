import { describe, it, expect } from 'vitest';
import { parseTags, createNote, createEvent, markDeleted, filterEntries } from './entry';

describe('parseTags', () => {
  it('extracts hashtags and lowercases them', () => {
    const result = parseTags('call the dentist #Health #todo');
    expect(result.tags).toEqual(['health', 'todo']);
    expect(result.text).toBe('call the dentist #Health #todo');
  });

  it('deduplicates repeated tags', () => {
    const result = parseTags('#idea great #idea again');
    expect(result.tags).toEqual(['idea']);
  });

  it('returns an empty tag list when there are no hashtags', () => {
    const result = parseTags('just plain text');
    expect(result.tags).toEqual([]);
  });
});

describe('createNote', () => {
  it('creates a note entry with parsed tags', () => {
    const entry = createNote('remember this #idea', 'device-1');
    expect(entry.type).toBe('note');
    expect(entry.tags).toEqual(['idea']);
    expect(entry.deviceId).toBe('device-1');
    expect(entry.deleted).toBe(false);
    expect(entry.id).toBeTruthy();
    expect(entry.createdAt).toBe(entry.modifiedAt);
  });
});

describe('createEvent', () => {
  it('creates an event entry with a date and time', () => {
    const entry = createEvent('dentist #health', '2026-08-01', '15:00', 'device-1');
    expect(entry.type).toBe('event');
    expect(entry.eventDate).toBe('2026-08-01');
    expect(entry.eventTime).toBe('15:00');
    expect(entry.tags).toEqual(['health']);
  });

  it('supports an optional linked note id', () => {
    const entry = createEvent('dentist', '2026-08-01', undefined, 'device-1', 'note-123');
    expect(entry.linkedNoteId).toBe('note-123');
  });
});

describe('markDeleted', () => {
  it('sets deleted and deletedAt without mutating the original', () => {
    const entry = createNote('temporary', 'device-1');
    const tombstoned = markDeleted(entry);
    expect(tombstoned.deleted).toBe(true);
    expect(tombstoned.deletedAt).toBeTypeOf('number');
    expect(entry.deleted).toBe(false);
  });
});

describe('filterEntries', () => {
  const entries = [
    createNote('buy milk #errand', 'device-1'),
    createNote('great podcast #listen', 'device-1'),
    createEvent('dentist appointment #health', '2026-08-01', '15:00', 'device-1'),
  ];

  it('matches by text query case-insensitively', () => {
    const result = filterEntries(entries, 'PODCAST', []);
    expect(result).toHaveLength(1);
    expect(result[0].text).toContain('podcast');
  });

  it('matches by selected tags', () => {
    const result = filterEntries(entries, '', ['health']);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('event');
  });

  it('combines query and tags with AND semantics', () => {
    const result = filterEntries(entries, 'milk', ['errand']);
    expect(result).toHaveLength(1);
  });

  it('returns everything when query and tags are empty', () => {
    expect(filterEntries(entries, '', [])).toHaveLength(3);
  });
});
