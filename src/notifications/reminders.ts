import { Entry } from '../models/entry';

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied';
  return Notification.requestPermission();
}

export function scheduleEventReminders(events: Entry[]): void {
  events
    .filter((e) => e.type === 'event' && !e.deleted && e.eventDate)
    .forEach((event) => {
      const when = new Date(`${event.eventDate}T${event.eventTime || '00:00'}`).getTime();
      const delay = when - Date.now();
      if (delay > 0 && delay < 24 * 60 * 60 * 1000) {
        setTimeout(() => {
          if (Notification.permission === 'granted') {
            new Notification('Jotterpad reminder', { body: event.text });
          }
        }, delay);
      }
    });
}
