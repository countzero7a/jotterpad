import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { requestNotificationPermission, scheduleEventReminders } from './reminders';
import { createEvent } from '../models/entry';

describe('reminders', () => {
  const notificationSpy = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    // Local-time construction (not a UTC ISO string) so "now" and the
    // production code's local-time event parsing agree on the same
    // timezone, regardless of the machine running the test.
    vi.setSystemTime(new Date(2026, 6, 23, 12, 0, 0));
    // @ts-expect-error test stub for the global Notification API
    global.Notification = vi.fn().mockImplementation((...args) => notificationSpy(...args));
    // @ts-expect-error test stub
    global.Notification.permission = 'granted';
    // @ts-expect-error test stub
    global.Notification.requestPermission = vi.fn().mockResolvedValue('granted');
    notificationSpy.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('requests permission via the Notification API', async () => {
    const result = await requestNotificationPermission();
    expect(result).toBe('granted');
  });

  it('schedules a notification for an event happening within 24 hours', () => {
    const event = createEvent('dentist', '2026-07-23', '18:00', 'device-1');
    scheduleEventReminders([event]);
    vi.advanceTimersByTime(6 * 60 * 60 * 1000 + 1000);
    expect(notificationSpy).toHaveBeenCalledWith('Jotterpad reminder', { body: 'dentist' });
  });

  it('does not schedule a notification for an event more than 24 hours away', () => {
    const event = createEvent('far future', '2026-08-01', '09:00', 'device-1');
    scheduleEventReminders([event]);
    vi.advanceTimersByTime(48 * 60 * 60 * 1000);
    expect(notificationSpy).not.toHaveBeenCalled();
  });

  it('does not schedule a notification for a past event', () => {
    const event = createEvent('already happened', '2026-07-20', '09:00', 'device-1');
    scheduleEventReminders([event]);
    vi.advanceTimersByTime(48 * 60 * 60 * 1000);
    expect(notificationSpy).not.toHaveBeenCalled();
  });

  it('does not fire duplicate notifications when scheduled repeatedly for the same event', () => {
    const event = createEvent('dentist', '2026-07-23', '18:00', 'device-1');
    // Simulate the app re-scheduling reminders on every entries reload
    // (e.g. Task 14's wiring) with overlapping event lists.
    scheduleEventReminders([event]);
    scheduleEventReminders([event]);
    vi.advanceTimersByTime(6 * 60 * 60 * 1000 + 1000);
    expect(notificationSpy).toHaveBeenCalledTimes(1);
  });
});
