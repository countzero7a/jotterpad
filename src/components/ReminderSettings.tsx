import { useState } from 'react';
import { requestNotificationPermission } from '../notifications/reminders';
import {
  getReminderLeadTime,
  setReminderLeadTime,
  ReminderLeadTime,
} from '../notifications/reminderSettings';

// Values must be numeric literals, not arithmetic expressions: TypeScript
// won't narrow an expression's result to a ReminderLeadTime literal, so a
// mistyped value here (e.g. 999) fails to compile against the value's type.
const LEAD_TIME_OPTIONS: { value: ReminderLeadTime; label: string }[] = [
  { value: 0, label: 'At event time' },
  { value: 300000, label: '5 min before' }, // 5 minutes
  { value: 900000, label: '15 min before' }, // 15 minutes
  { value: 1800000, label: '30 min before' }, // 30 minutes
  { value: 3600000, label: '1 hour before' }, // 1 hour
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

  function handleLeadTimeSelect(value: ReminderLeadTime) {
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
      <div className="theme-options" aria-label="Reminder lead time">
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
