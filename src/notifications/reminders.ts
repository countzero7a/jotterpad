import { Entry } from '../models/entry';
import { getReminderLeadTime } from './reminderSettings';

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied';
  return Notification.requestPermission();
}

async function fireNotification(title: string, body: string): Promise<void> {
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.ready;
      if (registration.showNotification) {
        await registration.showNotification(title, { body });
        return;
      }
    } catch {
      // fall through to the constructor below
    }
  }
  new Notification(title, { body });
}

// Tracks currently-pending reminder timers, keyed by entry id, so that
// repeated calls to scheduleEventReminders (e.g. after every entries reload)
// don't stack duplicate timers for the same event.
const scheduledTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleEventReminders(events: Entry[]): void {
  scheduledTimers.forEach((timerId) => clearTimeout(timerId));
  scheduledTimers.clear();

  const leadTimeMs = getReminderLeadTime();

  events
    .filter((e) => e.type === 'event' && !e.deleted && e.eventDate)
    .forEach((event) => {
      const when = new Date(`${event.eventDate}T${event.eventTime || '00:00'}`).getTime();
      const notifyAt = when - leadTimeMs;
      const delay = notifyAt - Date.now();
      if (delay > 0 && delay < 24 * 60 * 60 * 1000) {
        const timerId = setTimeout(() => {
          if (Notification.permission === 'granted') {
            const body =
              leadTimeMs > 0
                ? `${event.text} (at ${new Date(when).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })})`
                : event.text;
            fireNotification('Jotterpad reminder', body).catch(() => {});
          }
          scheduledTimers.delete(event.id);
        }, delay);
        scheduledTimers.set(event.id, timerId);
      }
    });
}
