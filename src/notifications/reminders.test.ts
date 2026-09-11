import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { requestNotificationPermission, scheduleEventReminders } from './reminders';
import { setReminderLeadTime } from './reminderSettings';
import { createEvent } from '../models/entry';

describe('reminders', () => {
  const notificationSpy = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    // Local-time construction (not a UTC ISO string) so "now" and the
    // production code's local-time event parsing agree on the same
    // timezone, regardless of the machine running the test.
    vi.setSystemTime(new Date(2026, 6, 23, 12, 0, 0));
    // @ts-expect-error test stub for the global Notification API
    global.Notification = vi.fn().mockImplementation((...args) => notificationSpy(...args));
    // @ts-expect-error test stub
    global.Notification.permission = 'granted';
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

  it('shifts the scheduled notification earlier by the configured lead time, and adds the event time to the body', () => {
    setReminderLeadTime(15 * 60 * 1000);
    const event = createEvent('dentist', '2026-07-23', '18:00', 'device-1');
    scheduleEventReminders([event]);

    // "now" is 2026-07-23 12:00 (set in beforeEach). Event is at 18:00, a
    // 15-minute lead time means the notification should fire at 17:45,
    // i.e. 5h45m after "now" -- not at the original 6h delay.
    vi.advanceTimersByTime(5 * 60 * 60 * 1000 + 45 * 60 * 1000 - 1000);
    expect(notificationSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);
    expect(notificationSpy).toHaveBeenCalledWith('Jotterpad reminder', {
      body: 'dentist (at 6:00 PM)',
    });
  });

  it('does not schedule a reminder when the lead time would push the notify time into the past', () => {
    setReminderLeadTime(15 * 60 * 1000);
    // Event is only 10 minutes from "now" -- a 15-minute lead time would
    // need to notify 5 minutes ago, which is impossible.
    const event = createEvent('soon', '2026-07-23', '12:10', 'device-1');
    scheduleEventReminders([event]);
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(notificationSpy).not.toHaveBeenCalled();
  });

  it('pulls an event that is just past the 24-hour window into range once the lead time shifts its notify time earlier', () => {
    setReminderLeadTime(15 * 60 * 1000);
    // Event is 24h10m from "now" -- outside the 24h window at its own
    // timestamp, but its lead-shifted notify time (23h55m from "now") is
    // inside the window.
    const event = createEvent('just outside', '2026-07-24', '12:10', 'device-1');
    scheduleEventReminders([event]);
    vi.advanceTimersByTime(23 * 60 * 60 * 1000 + 55 * 60 * 1000 - 1000);
    expect(notificationSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(notificationSpy).toHaveBeenCalledWith('Jotterpad reminder', {
      body: 'just outside (at 12:10 PM)',
    });
  });

  it('prefers the service worker registration over the Notification constructor when available', () => {
    const showNotification = vi.fn();
    // @ts-expect-error test stub for the global navigator.serviceWorker API
    global.navigator.serviceWorker = { ready: Promise.resolve({ showNotification }) };

    const event = createEvent('dentist', '2026-07-23', '18:00', 'device-1');
    scheduleEventReminders([event]);
    vi.advanceTimersByTime(6 * 60 * 60 * 1000 + 1000);

    return Promise.resolve().then(() => {
      expect(showNotification).toHaveBeenCalledWith('Jotterpad reminder', { body: 'dentist' });
      expect(notificationSpy).not.toHaveBeenCalled();
    });
  });
});
