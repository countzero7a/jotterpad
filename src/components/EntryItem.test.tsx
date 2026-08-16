import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { EntryItem } from './EntryItem';
import { createNote, createEvent } from '../models/entry';

describe('EntryItem', () => {
  it('renders entry text and tags', () => {
    const entry = createNote('buy milk #errand', 'device-1');
    render(<EntryItem entry={entry} onDelete={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.getByText('buy milk #errand')).toBeInTheDocument();
    expect(screen.getByText('#errand')).toBeInTheDocument();
  });

  it('switches to an editable form when Edit is clicked', async () => {
    const user = userEvent.setup();
    const entry = createNote('buy milk', 'device-1');
    render(<EntryItem entry={entry} onDelete={vi.fn()} onEdit={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByDisplayValue('buy milk')).toBeInTheDocument();
  });

  it('calls onEdit with the updated text on Save', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const entry = createNote('buy milk', 'device-1');
    render(<EntryItem entry={entry} onDelete={vi.fn()} onEdit={onEdit} />);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const input = screen.getByDisplayValue('buy milk');
    await user.clear(input);
    await user.type(input, 'buy oat milk');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onEdit).toHaveBeenCalledWith(entry.id, 'buy oat milk', undefined, undefined);
  });

  it('discards changes on Cancel', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const entry = createNote('buy milk', 'device-1');
    render(<EntryItem entry={entry} onDelete={vi.fn()} onEdit={onEdit} />);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const input = screen.getByDisplayValue('buy milk');
    await user.clear(input);
    await user.type(input, 'changed');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getByText('buy milk')).toBeInTheDocument();
  });

  it('shows and updates date/time fields for an event', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const entry = createEvent('dentist', '2026-08-01', '09:00', 'device-1');
    const { container } = render(<EntryItem entry={entry} onDelete={vi.fn()} onEdit={onEdit} />);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dateInput = container.querySelector('input[type="date"]');
    if (!dateInput) throw new Error('date input not found');
    fireEvent.change(dateInput, { target: { value: '2026-08-05' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onEdit).toHaveBeenCalledWith(entry.id, 'dentist', '2026-08-05', '09:00');
  });

  it('does not call onEdit when saving an event with an empty date', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const entry = createEvent('dentist', '2026-08-01', '09:00', 'device-1');
    const { container } = render(<EntryItem entry={entry} onDelete={vi.fn()} onEdit={onEdit} />);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dateInput = container.querySelector('input[type="date"]');
    if (!dateInput) throw new Error('date input not found');
    fireEvent.change(dateInput, { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('shows the latest entry text when re-entering edit mode after the entry prop changes', async () => {
    const user = userEvent.setup();
    const entry = createNote('milk', 'device-1');
    const { rerender } = render(<EntryItem entry={entry} onDelete={vi.fn()} onEdit={vi.fn()} />);

    const updatedEntry = { ...entry, text: 'oat milk (from other device)', modifiedAt: entry.modifiedAt + 1 };
    rerender(<EntryItem entry={updatedEntry} onDelete={vi.fn()} onEdit={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByDisplayValue('oat milk (from other device)')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('milk')).not.toBeInTheDocument();
  });

  it('does not wipe an in-progress unsaved edit when the entry prop changes while already editing', async () => {
    const user = userEvent.setup();
    const entry = createNote('milk', 'device-1');
    const { rerender } = render(<EntryItem entry={entry} onDelete={vi.fn()} onEdit={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const input = screen.getByDisplayValue('milk');
    await user.clear(input);
    await user.type(input, 'unsaved draft text');

    // Simulate a sync/merge echoing an update back while the user is still
    // editing (e.g. an in-flight save round-tripping, or an unrelated remote
    // change). This must NOT clobber the user's in-progress typing.
    const updatedEntry = { ...entry, text: 'synced elsewhere', modifiedAt: entry.modifiedAt + 1 };
    rerender(<EntryItem entry={updatedEntry} onDelete={vi.fn()} onEdit={vi.fn()} />);

    expect(screen.getByDisplayValue('unsaved draft text')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('synced elsewhere')).not.toBeInTheDocument();
  });
});
