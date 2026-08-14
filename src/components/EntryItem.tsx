import { useState } from 'react';
import { Entry } from '../models/entry';

interface EntryItemProps {
  entry: Entry;
  onDelete: (id: string) => void;
  onEdit: (id: string, rawText: string, eventDate?: string, eventTime?: string) => void;
}

export function EntryItem({ entry, onDelete, onEdit }: EntryItemProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(entry.text);
  const [eventDate, setEventDate] = useState(entry.eventDate ?? '');
  const [eventTime, setEventTime] = useState(entry.eventTime ?? '');

  function handleSave() {
    if (!text.trim()) return;
    if (entry.type === 'event' && !eventDate) return;
    onEdit(
      entry.id,
      text,
      entry.type === 'event' ? eventDate : undefined,
      entry.type === 'event' ? eventTime : undefined
    );
    setEditing(false);
  }

  function handleCancel() {
    setText(entry.text);
    setEventDate(entry.eventDate ?? '');
    setEventTime(entry.eventTime ?? '');
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="entry entry-editing" data-type={entry.type}>
        <input value={text} onChange={(e) => setText(e.target.value)} />
        {entry.type === 'event' && (
          <>
            <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
            <input type="time" value={eventTime} onChange={(e) => setEventTime(e.target.value)} />
          </>
        )}
        <button onClick={handleSave}>Save</button>
        <button onClick={handleCancel}>Cancel</button>
      </div>
    );
  }

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
      <button onClick={() => setEditing(true)}>Edit</button>
      <button onClick={() => onDelete(entry.id)}>Delete</button>
    </div>
  );
}
