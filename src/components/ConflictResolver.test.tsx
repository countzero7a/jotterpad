import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ConflictResolver } from './ConflictResolver';
import { createNote, createEvent } from '../models/entry';

describe('ConflictResolver', () => {
  it('renders nothing when there are no conflicts', () => {
    const { container } = render(<ConflictResolver conflicts={[]} onResolve={vi.fn()} onDefer={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows both versions of the first conflict', () => {
    const local = createNote('local version', 'device-a');
    const remote = createNote('remote version', 'device-b');
    render(<ConflictResolver conflicts={[{ local, remote }]} onResolve={vi.fn()} onDefer={vi.fn()} />);
    expect(screen.getByText(/local version/)).toBeInTheDocument();
    expect(screen.getByText(/remote version/)).toBeInTheDocument();
  });

  it('calls onResolve with the chosen version', async () => {
    const user = userEvent.setup();
    const local = createNote('local version', 'device-a');
    const remote = createNote('remote version', 'device-b');
    const onResolve = vi.fn();
    render(<ConflictResolver conflicts={[{ local, remote }]} onResolve={onResolve} onDefer={vi.fn()} />);
    await user.click(screen.getByText(/local version/));
    expect(onResolve).toHaveBeenCalledWith(local);
  });

  it('calls onResolve with the remote version when the other device button is clicked', async () => {
    const user = userEvent.setup();
    const local = createNote('local version', 'device-a');
    const remote = createNote('remote version', 'device-b');
    const onResolve = vi.fn();
    render(<ConflictResolver conflicts={[{ local, remote }]} onResolve={onResolve} onDefer={vi.fn()} />);
    await user.click(screen.getByText(/remote version/));
    expect(onResolve).toHaveBeenCalledWith(remote);
  });

  it('calls onDefer when "Decide later" is clicked', async () => {
    const user = userEvent.setup();
    const local = createNote('local version', 'device-a');
    const remote = createNote('remote version', 'device-b');
    const onDefer = vi.fn();
    render(<ConflictResolver conflicts={[{ local, remote }]} onResolve={vi.fn()} onDefer={onDefer} />);
    await user.click(screen.getByRole('button', { name: 'Decide later' }));
    expect(onDefer).toHaveBeenCalled();
  });

  it('shows an error message when one is provided', () => {
    const local = createNote('local version', 'device-a');
    const remote = createNote('remote version', 'device-b');
    render(
      <ConflictResolver
        conflicts={[{ local, remote }]}
        onResolve={vi.fn()}
        onDefer={vi.fn()}
        error="Could not save your chosen version."
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save your chosen version.');
  });

  it('distinguishes a deleted version from an edited one with the same text', () => {
    const local = { ...createNote('shared text', 'device-a'), deleted: true, deletedAt: Date.now() };
    const remote = createNote('shared text', 'device-b');
    render(<ConflictResolver conflicts={[{ local, remote }]} onResolve={vi.fn()} onDefer={vi.fn()} />);
    expect(screen.getByRole('button', { name: /This device's version: \(deleted\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Other device's version: shared text/ })).toBeInTheDocument();
  });

  it('includes the event date/time in the version description for events', () => {
    const local = createEvent('dentist', '2026-08-01', '09:00', 'device-a');
    const remote = createEvent('dentist', '2026-08-05', '14:00', 'device-b');
    render(<ConflictResolver conflicts={[{ local, remote }]} onResolve={vi.fn()} onDefer={vi.fn()} />);
    expect(screen.getByRole('button', { name: /This device's version: dentist — 2026-08-01 09:00/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Other device's version: dentist — 2026-08-05 14:00/ })).toBeInTheDocument();
  });
});
