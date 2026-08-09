import { Entry } from '../models/entry';

interface EntryItemProps {
  entry: Entry;
  onDelete: (id: string) => void;
}

export function EntryItem({ entry, onDelete }: EntryItemProps) {
  return (
    <div className="entry" data-type={entry.type}>
      <span>{entry.type === 'event' ? '📅' : '📝'}</span>
      <span>{entry.text}</span>
      {entry.type === 'event' && (
        <span>
          {entry.eventDate} {entry.eventTime}
        </span>
      )}
      {entry.tags.map((tag) => (
        <span key={tag} className="tag">
          #{tag}
        </span>
      ))}
      <button onClick={() => onDelete(entry.id)}>Delete</button>
    </div>
  );
}
