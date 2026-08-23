import { Entry } from '../models/entry';
import { SyncBundle } from './syncActions';

export function isEntry(value: unknown): value is Entry {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  if (typeof e.id !== 'string') return false;
  if (e.type !== 'note' && e.type !== 'event') return false;
  if (typeof e.text !== 'string') return false;
  if (!Array.isArray(e.tags) || !e.tags.every((t) => typeof t === 'string')) return false;
  if (typeof e.createdAt !== 'number') return false;
  if (typeof e.modifiedAt !== 'number') return false;
  if (typeof e.deviceId !== 'string') return false;
  if (typeof e.deleted !== 'boolean') return false;
  if (e.eventDate !== undefined && typeof e.eventDate !== 'string') return false;
  if (e.eventTime !== undefined && typeof e.eventTime !== 'string') return false;
  if (e.linkedNoteId !== undefined && typeof e.linkedNoteId !== 'string') return false;
  if (e.deletedAt !== undefined && typeof e.deletedAt !== 'number') return false;
  return true;
}

export function isSyncBundle(value: unknown): value is SyncBundle {
  if (typeof value !== 'object' || value === null) return false;
  const b = value as Record<string, unknown>;
  if (typeof b.senderDeviceId !== 'string') return false;
  if (!Array.isArray(b.entries)) return false;
  return b.entries.every(isEntry);
}
