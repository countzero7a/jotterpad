import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Timeline } from './Timeline';
import { createNote, createEvent } from '../models/entry';

describe('Timeline', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-07-23T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders past notes and events in chronological order', () => {
    const note = createNote('first thought', 'device-1');
    const event = createEvent('past appointment', '2026-07-20', '09:00', 'device-1');
    render(
      <Timeline
        entries={[event, note]}
        onAddNote={vi.fn()}
        onAddEvent={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />
    );
    expect(screen.getByText('first thought')).toBeInTheDocument();
    expect(screen.getByText('past appointment')).toBeInTheDocument();
  });

  it('renders future events below past entries', () => {
    const upcoming = createEvent('future appointment', '2026-08-01', '09:00', 'device-1');
    render(
      <Timeline
        entries={[upcoming]}
        onAddNote={vi.fn()}
        onAddEvent={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />
    );
    expect(screen.getByText('future appointment')).toBeInTheDocument();
  });

  it('adds a note through the capture bar in note mode', async () => {
    const user = userEvent.setup({ delay: null });
    const onAddNote = vi.fn();
    render(
      <Timeline entries={[]} onAddNote={onAddNote} onAddEvent={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} />
    );
    await user.type(screen.getByPlaceholderText('Jot a thought...'), 'a new idea');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(onAddNote).toHaveBeenCalledWith('a new idea');
  });

  it('adds an event through the capture bar after toggling to event mode', async () => {
    const user = userEvent.setup({ delay: null });
    const onAddEvent = vi.fn();
    const { container } = render(
      <Timeline
        entries={[]}
        onAddNote={vi.fn()}
        onAddEvent={onAddEvent}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Note' }));
    await user.type(screen.getByPlaceholderText('Jot a thought...'), 'dentist');
    const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
    if (!dateInput) throw new Error('date input not found');
    fireEvent.change(dateInput, { target: { value: '2026-08-01' } });
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(onAddEvent).toHaveBeenCalledWith('dentist', '2026-08-01', '');
  });

  it('calls onDelete when an entry is deleted', async () => {
    const user = userEvent.setup({ delay: null });
    const onDelete = vi.fn();
    const note = createNote('delete me', 'device-1');
    render(
      <Timeline entries={[note]} onAddNote={vi.fn()} onAddEvent={vi.fn()} onDelete={onDelete} onEdit={vi.fn()} />
    );
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith(note.id);
  });

  it('threads edits through to onEdit', async () => {
    const user = userEvent.setup({ delay: null });
    const onEdit = vi.fn();
    const note = createNote('buy milk', 'device-1');
    render(
      <Timeline entries={[note]} onAddNote={vi.fn()} onAddEvent={vi.fn()} onDelete={vi.fn()} onEdit={onEdit} />
    );
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const input = screen.getByDisplayValue('buy milk');
    await user.clear(input);
    await user.type(input, 'buy oat milk');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onEdit).toHaveBeenCalledWith(note.id, 'buy oat milk', undefined, undefined);
  });
});
