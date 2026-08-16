import { ConflictPair } from '../sync/merge';
import { Entry } from '../models/entry';

interface ConflictResolverProps {
  conflicts: ConflictPair[];
  onResolve: (entry: Entry) => void;
  onDefer: () => void;
  error?: string | null;
}

export function ConflictResolver({ conflicts, onResolve, onDefer, error }: ConflictResolverProps) {
  if (conflicts.length === 0) return null;
  const current = conflicts[0];
  return (
    <div className="conflict-resolver">
      <h2>Conflicting changes</h2>
      <p>This entry was edited on both devices since the last sync. Pick one:</p>
      {error && <p role="alert">{error}</p>}
      <button onClick={() => onResolve(current.local)}>This device's version: {current.local.text}</button>
      <button onClick={() => onResolve(current.remote)}>Other device's version: {current.remote.text}</button>
      <button onClick={onDefer}>Decide later</button>
    </div>
  );
}
