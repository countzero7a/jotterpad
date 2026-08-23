import { describe, it, expect } from 'vitest';
import { isEntry, isSyncBundle } from './validate';
import { createNote, createEvent, markDeleted } from '../models/entry';

describe('isEntry', () => {
  it('accepts a genuine note entry', () => {
    expect(isEntry(createNote('hello', 'device-1'))).toBe(true);
  });

  it('accepts a genuine event entry', () => {
    expect(isEntry(createEvent('dentist', '2026-08-01', '09:00', 'device-1'))).toBe(true);
  });

  it('rejects null and non-object values', () => {
    expect(isEntry(null)).toBe(false);
    expect(isEntry('not an entry')).toBe(false);
    expect(isEntry(42)).toBe(false);
  });

  it('rejects an object missing required fields', () => {
    expect(isEntry({ id: '1', type: 'note' })).toBe(false);
  });

  it('rejects an object with the wrong type for a field', () => {
    const entry = createNote('hello', 'device-1');
    expect(isEntry({ ...entry, tags: 'not-an-array' })).toBe(false);
  });

  it('rejects an invalid type value', () => {
    const entry = createNote('hello', 'device-1');
    expect(isEntry({ ...entry, type: 'reminder' })).toBe(false);
  });

  it('rejects an entry with a wrong-typed linkedNoteId', () => {
    const entry = createEvent('dentist', '2026-08-01', '09:00', 'device-1', 'valid-note-id');
    expect(isEntry({ ...entry, linkedNoteId: 12345 })).toBe(false);
  });

  it('rejects an entry with a wrong-typed deletedAt', () => {
    const entry = markDeleted(createNote('hello', 'device-1'));
    expect(isEntry({ ...entry, deletedAt: 'yesterday' })).toBe(false);
  });

  it('accepts an entry with a valid linkedNoteId string', () => {
    expect(isEntry(createEvent('dentist', '2026-08-01', '09:00', 'device-1', 'valid-note-id'))).toBe(true);
  });

  it('accepts an entry with a valid deletedAt number', () => {
    expect(isEntry(markDeleted(createNote('hello', 'device-1')))).toBe(true);
  });
});

describe('isSyncBundle', () => {
  it('accepts a genuine bundle', () => {
    const bundle = { senderDeviceId: 'device-1', entries: [createNote('hello', 'device-1')] };
    expect(isSyncBundle(bundle)).toBe(true);
  });

  it('accepts a bundle with an empty entries array', () => {
    expect(isSyncBundle({ senderDeviceId: 'device-1', entries: [] })).toBe(true);
  });

  it('rejects a bundle missing senderDeviceId', () => {
    expect(isSyncBundle({ entries: [] })).toBe(false);
  });

  it('rejects a bundle whose entries contain something invalid', () => {
    expect(isSyncBundle({ senderDeviceId: 'device-1', entries: [{ bogus: true }] })).toBe(false);
  });

  it('rejects non-object values', () => {
    expect(isSyncBundle(null)).toBe(false);
    expect(isSyncBundle('nope')).toBe(false);
  });
});
