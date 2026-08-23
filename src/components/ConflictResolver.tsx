import { ConflictPair } from '../sync/merge';
import { Entry } from '../models/entry';

interface ConflictResolverProps {
  conflicts: ConflictPair[];
  onResolve: (entry: Entry) => void;
  onDefer: () => void;
  error?: string | null;
}

function describeVersion(entry: Entry): string {
  if (entry.deleted) return '(deleted)';
  if (entry.type === 'event' && entry.eventDate) {
    return `${entry.text} — ${entry.eventDate}${entry.eventTime ? ' ' + entry.eventTime : ''}`;
  }
  return entry.text;
}

export function ConflictResolver({ conflicts, onResolve, onDefer, error }: ConflictResolverProps) {
  if (conflicts.length === 0) return null;
  const current = conflicts[0];
  return (
    <div className="conflict-resolver">
      <h2>Conflicting changes</h2>
      <p>This entry was edited on both devices since the last sync. Pick one:</p>
      {error && <p role="alert">{error}</p>}
      <button onClick={() => onResolve(current.local)}>
        This device's version: {describeVersion(current.local)}
      </button>
      <button onClick={() => onResolve(current.remote)}>
        Other device's version: {describeVersion(current.remote)}
      </button>
      <button onClick={onDefer}>Decide later</button>
    </div>
  );
}
