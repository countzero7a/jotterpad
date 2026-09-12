import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReminderSettings } from './ReminderSettings';

describe('ReminderSettings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders all five lead-time options', () => {
    render(<ReminderSettings />);
    expect(screen.getByRole('button', { name: 'At event time' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '5 min before' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '15 min before' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '30 min before' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1 hour before' })).toBeInTheDocument();
  });

  it('highlights "At event time" as active by default', () => {
    render(<ReminderSettings />);
    expect(screen.getByRole('button', { name: 'At event time' })).toHaveClass('active');
    expect(screen.getByRole('button', { name: '15 min before' })).not.toHaveClass('active');
  });

  it('persists the selected lead time and notifies the caller immediately on click', async () => {
    const user = userEvent.setup();
    const onLeadTimeChange = vi.fn();
    render(<ReminderSettings onLeadTimeChange={onLeadTimeChange} />);

    await user.click(screen.getByRole('button', { name: '15 min before' }));

    expect(localStorage.getItem('jotterpad-reminder-lead-ms')).toBe(String(15 * 60 * 1000));
    expect(screen.getByRole('button', { name: '15 min before' })).toHaveClass('active');
    expect(screen.getByRole('button', { name: 'At event time' })).not.toHaveClass('active');
    expect(onLeadTimeChange).toHaveBeenCalledTimes(1);
  });

  it('reflects an already-stored lead time on mount', () => {
    localStorage.setItem('jotterpad-reminder-lead-ms', String(30 * 60 * 1000));
    render(<ReminderSettings />);
    expect(screen.getByRole('button', { name: '30 min before' })).toHaveClass('active');
  });
});
