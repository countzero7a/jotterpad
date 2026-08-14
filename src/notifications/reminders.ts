import { Entry } from '../models/entry';

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied';
  return Notification.requestPermission();
}

// Tracks currently-pending reminder timers, keyed by entry id, so that
// repeated calls to scheduleEventReminders (e.g. after every entries reload)
// don't stack duplicate timers for the same event.
const scheduledTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleEventReminders(events: Entry[]): void {
  scheduledTimers.forEach((timerId) => clearTimeout(timerId));
  scheduledTimers.clear();

  events
    .filter((e) => e.type === 'event' && !e.deleted && e.eventDate)
    .forEach((event) => {
      const when = new Date(`${event.eventDate}T${event.eventTime || '00:00'}`).getTime();
      const delay = when - Date.now();
      if (delay > 0 && delay < 24 * 60 * 60 * 1000) {
        const timerId = setTimeout(() => {
          if (Notification.permission === 'granted') {
            new Notification('Jotterpad reminder', { body: event.text });
          }
          scheduledTimers.delete(event.id);
        }, delay);
        scheduledTimers.set(event.id, timerId);
      }
    });
}
