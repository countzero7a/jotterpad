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
});
