import { describe, it, expect } from 'vitest';
import { selectChangedSince, mergeEntries } from './merge';
import { Entry } from '../models/entry';

function makeEntry(overrides: Partial<Entry>): Entry {
  return {
    id: 'entry-1',
    type: 'note',
    text: 'original text',
    tags: [],
    createdAt: 1000,
    modifiedAt: 1000,
    deviceId: 'device-a',
    deleted: false,
    ...overrides,
  };
}

describe('selectChangedSince', () => {
  it('returns only entries modified after the given timestamp', () => {
    const older = makeEntry({ id: 'a', modifiedAt: 500 });
    const newer = makeEntry({ id: 'b', modifiedAt: 1500 });
    expect(selectChangedSince([older, newer], 1000)).toEqual([newer]);
  });
});

describe('mergeEntries', () => {
  it('unions in a brand-new remote entry', () => {
    const local: Entry[] = [];
    const remote = [makeEntry({ id: 'remote-1' })];
    const { merged, conflicts } = mergeEntries(local, remote, 0);
    expect(merged).toHaveLength(1);
    expect(conflicts).toHaveLength(0);
  });

  it('keeps the local entry unchanged when content is identical', () => {
    const local = [makeEntry({ id: 'a', modifiedAt: 1000 })];
    const remote = [makeEntry({ id: 'a', modifiedAt: 1000 })];
    const { merged, conflicts } = mergeEntries(local, remote, 0);
    expect(merged).toHaveLength(1);
    expect(conflicts).toHaveLength(0);
  });

  it('takes the remote version when only remote changed since last sync', () => {
    const local = [makeEntry({ id: 'a', modifiedAt: 500, text: 'old' })];
    const remote = [makeEntry({ id: 'a', modifiedAt: 2000, text: 'updated remotely' })];
    const { merged, conflicts } = mergeEntries(local, remote, 1000);
    expect(merged.find((e) => e.id === 'a')?.text).toBe('updated remotely');
    expect(conflicts).toHaveLength(0);
  });

  it('keeps the local version when only local changed since last sync', () => {
    const local = [makeEntry({ id: 'a', modifiedAt: 2000, text: 'updated locally' })];
    const remote = [makeEntry({ id: 'a', modifiedAt: 500, text: 'old' })];
    const { merged, conflicts } = mergeEntries(local, remote, 1000);
    expect(merged.find((e) => e.id === 'a')?.text).toBe('updated locally');
    expect(conflicts).toHaveLength(0);
  });

  it('flags a conflict when both sides changed the same entry differently since last sync', () => {
    const local = [makeEntry({ id: 'a', modifiedAt: 2000, text: 'local edit' })];
    const remote = [makeEntry({ id: 'a', modifiedAt: 2100, text: 'remote edit' })];
    const { conflicts } = mergeEntries(local, remote, 1000);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].local.text).toBe('local edit');
    expect(conflicts[0].remote.text).toBe('remote edit');
  });

  it('propagates a remote deletion when local did not change the entry since last sync', () => {
    const local = [makeEntry({ id: 'a', modifiedAt: 500 })];
    const remote = [makeEntry({ id: 'a', modifiedAt: 2000, deleted: true, deletedAt: 2000 })];
    const { merged, conflicts } = mergeEntries(local, remote, 1000);
    expect(merged.find((e) => e.id === 'a')?.deleted).toBe(true);
    expect(conflicts).toHaveLength(0);
  });

  it('flags a conflict when one side deleted and the other edited the same entry since last sync', () => {
    const local = [makeEntry({ id: 'a', modifiedAt: 2000, text: 'still useful' })];
    const remote = [makeEntry({ id: 'a', modifiedAt: 2100, deleted: true, deletedAt: 2100 })];
    const { conflicts } = mergeEntries(local, remote, 1000);
    expect(conflicts).toHaveLength(1);
  });

  it('does not flag a conflict when both sides deleted the same entry independently', () => {
    const local = [makeEntry({ id: 'a', modifiedAt: 2000, deleted: true, deletedAt: 2000 })];
    const remote = [makeEntry({ id: 'a', modifiedAt: 2100, deleted: true, deletedAt: 2100 })];
    const { merged, conflicts } = mergeEntries(local, remote, 1000);
    expect(conflicts).toHaveLength(0);
    expect(merged.find((e) => e.id === 'a')?.deleted).toBe(true);
  });

  it('treats a lastSyncAt of 0 as a full merge (first-ever sync)', () => {
    const local = [makeEntry({ id: 'a', modifiedAt: 100, text: 'from before pairing' })];
    const remote = [makeEntry({ id: 'a', modifiedAt: 200, text: 'also from before pairing' })];
    const { conflicts } = mergeEntries(local, remote, 0);
    expect(conflicts).toHaveLength(1);
  });

  it('preserves local-only entries when merging with distinct remote entries', () => {
    const local = [makeEntry({ id: 'local-only', text: 'only on local device' })];
    const remote = [makeEntry({ id: 'remote-only', text: 'only on remote device' })];
    const { merged, conflicts } = mergeEntries(local, remote, 0);
    expect(merged).toHaveLength(2);
    expect(merged.find((e) => e.id === 'local-only')).toBeDefined();
    expect(merged.find((e) => e.id === 'remote-only')).toBeDefined();
    expect(conflicts).toHaveLength(0);
  });

  it('does not flag a conflict when tag order differs but content is otherwise identical', () => {
    const local = [makeEntry({ id: 'a', tags: ['x', 'y'], modifiedAt: 1000 })];
    const remote = [makeEntry({ id: 'a', tags: ['y', 'x'], modifiedAt: 1000 })];
    const { merged, conflicts } = mergeEntries(local, remote, 0);
    expect(merged).toHaveLength(1);
    expect(conflicts).toHaveLength(0);
  });
});
