import { useState } from 'react';
import { requestNotificationPermission } from '../notifications/reminders';

export function ReminderSettings() {
  const [status, setStatus] = useState<NotificationPermission | 'unrequested'>('unrequested');

  async function handleRequest() {
    setStatus(await requestNotificationPermission());
  }

  return (
    <div>
      <h2>Reminders</h2>
      <p>
        Reminders only fire while Jotterpad is open or running in the background, per your
        browser's own support. They are not guaranteed to fire if the app is fully closed,
        especially on iOS.
      </p>
      <button onClick={handleRequest}>Enable reminders</button>
      <p>Status: {status}</p>
    </div>
  );
}
