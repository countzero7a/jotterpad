import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { LockScreen } from './LockScreen';
import { setupPin } from '../auth/pin';
import * as pinModule from '../auth/pin';
import { getDb } from '../storage/db';

async function resetDb() {
  const db = await getDb();
  await db.clear('meta');
}

describe('LockScreen', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('shows the unrecoverability warning in setup mode', () => {
    render(<LockScreen mode="setup" onUnlock={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/unrecoverable/i);
  });

  it('rejects mismatched pins during setup', async () => {
    const user = userEvent.setup();
    render(<LockScreen mode="setup" onUnlock={vi.fn()} />);
    await user.type(screen.getByPlaceholderText('PIN'), '1234');
    await user.type(screen.getByPlaceholderText('Confirm PIN'), '5678');
    await user.click(screen.getByRole('button', { name: 'Set PIN' }));
    expect(screen.getByText(/do not match/i)).toBeInTheDocument();
  });

  it('calls onUnlock with a key after successful setup', async () => {
    const user = userEvent.setup();
    const onUnlock = vi.fn();
    render(<LockScreen mode="setup" onUnlock={onUnlock} />);
    await user.type(screen.getByPlaceholderText('PIN'), '1234');
    await user.type(screen.getByPlaceholderText('Confirm PIN'), '1234');
    await user.click(screen.getByRole('button', { name: 'Set PIN' }));
    await waitFor(() => expect(onUnlock).toHaveBeenCalledTimes(1));
  });

  it('shows an error for the wrong pin in unlock mode', async () => {
    await setupPin('4242');
    const user = userEvent.setup();
    render(<LockScreen mode="unlock" onUnlock={vi.fn()} />);
    await user.type(screen.getByPlaceholderText('PIN'), '0000');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    await waitFor(() => expect(screen.getByText(/incorrect pin/i)).toBeInTheDocument());
  });

  it('calls onUnlock for the correct pin in unlock mode', async () => {
    await setupPin('4242');
    const user = userEvent.setup();
    const onUnlock = vi.fn();
    render(<LockScreen mode="unlock" onUnlock={onUnlock} />);
    await user.type(screen.getByPlaceholderText('PIN'), '4242');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    await waitFor(() => expect(onUnlock).toHaveBeenCalledTimes(1));
  });

  it('shows an error message when setupPin fails', async () => {
    const user = userEvent.setup();
    const setupSpy = vi.spyOn(pinModule, 'setupPin').mockRejectedValue(new Error('Storage error'));
    const onUnlock = vi.fn();
    render(<LockScreen mode="setup" onUnlock={onUnlock} />);
    await user.type(screen.getByPlaceholderText('PIN'), '1234');
    await user.type(screen.getByPlaceholderText('Confirm PIN'), '1234');
    await user.click(screen.getByRole('button', { name: 'Set PIN' }));
    await waitFor(() => expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument());
    expect(onUnlock).not.toHaveBeenCalled();
    setupSpy.mockRestore();
  });

  it('disables the submit button while a PIN operation is in flight', async () => {
    const user = userEvent.setup();
    render(<LockScreen mode="setup" onUnlock={vi.fn()} />);
    await user.type(screen.getByPlaceholderText('PIN'), '1234');
    await user.type(screen.getByPlaceholderText('Confirm PIN'), '1234');
    const button = screen.getByRole('button', { name: 'Set PIN' });
    await user.click(button);
    expect(button).toBeDisabled();
  });

  it('only invokes setupPin once when two submits are dispatched in the same tick', async () => {
    const setupSpy = vi.spyOn(pinModule, 'setupPin');
    const onUnlock = vi.fn();
    render(<LockScreen mode="setup" onUnlock={onUnlock} />);
    fireEvent.change(screen.getByPlaceholderText('PIN'), { target: { value: '1234' } });
    fireEvent.change(screen.getByPlaceholderText('Confirm PIN'), { target: { value: '1234' } });
    const button = screen.getByRole('button', { name: 'Set PIN' });

    // Dispatch two submits back-to-back inside a single act() batch, without letting React
    // commit the first `setSubmitting(true)` in between. This reproduces a same-tick
    // double-dispatch (e.g. a duplicated click or racing event handlers): both invocations of
    // handleSubmit's synchronous prelude run against stale `submitting === false` state before
    // either update is flushed. A guard backed by React state alone cannot detect this; a ref
    // updates synchronously and does.
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });

    await waitFor(() => expect(onUnlock).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(setupSpy).toHaveBeenCalledTimes(1);
    setupSpy.mockRestore();
  });
});
