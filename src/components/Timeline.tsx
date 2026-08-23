import { useEffect, useRef } from 'react';
import { Entry } from '../models/entry';
import { CaptureBar } from './CaptureBar';
import { EntryItem } from './EntryItem';

interface TimelineProps {
  entries: Entry[];
  onAddNote: (rawText: string) => void;
  onAddEvent: (rawText: string, eventDate: string, eventTime: string) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string, rawText: string, eventDate?: string, eventTime?: string) => void;
}

function eventTimestamp(entry: Entry): number {
  return new Date(`${entry.eventDate}T${entry.eventTime || '00:00'}`).getTime();
}

export function Timeline({ entries, onAddNote, onAddEvent, onDelete, onEdit }: TimelineProps) {
  const now = Date.now();
  const feedRef = useRef<HTMLDivElement>(null);

  const past = entries
    .filter((e) => e.type === 'note' || (e.eventDate && eventTimestamp(e) <= now))
    .sort((a, b) => a.createdAt - b.createdAt);

  const upcoming = entries
    .filter((e) => e.type === 'event' && e.eventDate && eventTimestamp(e) > now)
    .sort((a, b) => eventTimestamp(a) - eventTimestamp(b));

  // Scroll the feed to the newest entry whenever the entry list changes, so a
  // freshly captured note doesn't land off-screen on a non-empty timeline.
  // `scrollTo` isn't implemented in jsdom -- the element itself is truthy
  // there, but `.scrollTo` is `undefined`, so it must be optional-called too
  // (not just the ref) or every test that mounts Timeline throws.
  useEffect(() => {
    feedRef.current?.scrollTo?.({ top: feedRef.current.scrollHeight });
  }, [entries]);

  return (
    <div className="timeline">
      <div className="feed" ref={feedRef}>
        {past.map((entry) => (
          <EntryItem key={entry.id} entry={entry} onDelete={onDelete} onEdit={onEdit} />
        ))}
        {upcoming.map((entry) => (
          <EntryItem key={entry.id} entry={entry} onDelete={onDelete} onEdit={onEdit} />
        ))}
      </div>
      <CaptureBar onAddNote={onAddNote} onAddEvent={onAddEvent} />
    </div>
  );
}
