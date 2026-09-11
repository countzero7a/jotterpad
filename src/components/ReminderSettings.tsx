import { useState } from 'react';
import { requestNotificationPermission } from '../notifications/reminders';
import { getReminderLeadTime, setReminderLeadTime } from '../notifications/reminderSettings';

const LEAD_TIME_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'At event time' },
  { value: 5 * 60 * 1000, label: '5 min before' },
  { value: 15 * 60 * 1000, label: '15 min before' },
  { value: 30 * 60 * 1000, label: '30 min before' },
  { value: 60 * 60 * 1000, label: '1 hour before' },
];

interface ReminderSettingsProps {
  onLeadTimeChange?: () => void;
}

export function ReminderSettings({ onLeadTimeChange }: ReminderSettingsProps) {
  const [status, setStatus] = useState<NotificationPermission | 'unrequested'>('unrequested');
  const [leadTime, setLeadTime] = useState<number>(getReminderLeadTime);

  async function handleRequest() {
    setStatus(await requestNotificationPermission());
  }

  function handleLeadTimeSelect(value: number) {
    setReminderLeadTime(value);
    setLeadTime(value);
    onLeadTimeChange?.();
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
      <div className="theme-options">
        {LEAD_TIME_OPTIONS.map(({ value, label }) => (
          <button
            key={value}
            className={leadTime === value ? 'active' : undefined}
            onClick={() => handleLeadTimeSelect(value)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
