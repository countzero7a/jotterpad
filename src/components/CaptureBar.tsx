import { useState, FormEvent } from 'react';

interface CaptureBarProps {
  onAddNote: (rawText: string) => void;
  onAddEvent: (rawText: string, eventDate: string, eventTime: string) => void;
}

export function CaptureBar({ onAddNote, onAddEvent }: CaptureBarProps) {
  const [mode, setMode] = useState<'note' | 'event'>('note');
  const [text, setText] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    if (mode === 'note') {
      onAddNote(text);
    } else {
      if (!date) return;
      onAddEvent(text, date, time);
    }
    setText('');
    setDate('');
    setTime('');
  }

  return (
    <form onSubmit={handleSubmit} className="capture-bar">
      <button type="button" onClick={() => setMode(mode === 'note' ? 'event' : 'note')}>
        {mode === 'note' ? 'Note' : 'Event'}
      </button>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Jot a thought..." />
      {mode === 'event' && (
        <>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </>
      )}
      <button type="submit">Add</button>
    </form>
  );
}
