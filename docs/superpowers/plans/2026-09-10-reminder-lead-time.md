# Configurable Reminder Lead-Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user choose how long before an event they're notified (at event time / 5 / 15 / 30 min / 1 hour before), instead of always firing exactly at the event's start time.

**Architecture:** A new device-local `localStorage`-backed setting (`src/notifications/reminderSettings.ts`), read by the existing `scheduleEventReminders` scheduling logic (`src/notifications/reminders.ts`) to shift its trigger point earlier, plus a button-group UI in the existing `ReminderSettings` component that writes the setting and immediately reschedules.

**Tech Stack:** React + TypeScript, Vitest + Testing Library, `localStorage` Web API, existing `Notification`/service-worker reminder plumbing from Task 13.

## Global Constraints

- Lead-time values are restricted to exactly these five options, in milliseconds: `0`, `300000` (5 min), `900000` (15 min), `1800000` (30 min), `3600000` (1 hour).
- The setting lives in `localStorage` under key `jotterpad-reminder-lead-ms` — never in the encrypted IndexedDB store, and never included in QR sync bundles or backup exports.
- `localStorage` reads/writes must be wrapped in `try/catch`, matching the existing pattern in `src/theme.ts`.
- No changes to the existing 24-hour scheduling window bound or the hourly rescan interval in `App.tsx` — only what "trigger point" is measured against changes.

---

### Task 1: Reminder Lead-Time Storage Module

**Files:**
- Create: `src/notifications/reminderSettings.ts`
- Test: `src/notifications/reminderSettings.test.ts`

**Interfaces:**
- Produces: `REMINDER_LEAD_OPTIONS: readonly number[]` (exactly `[0, 300000, 900000, 1800000, 3600000]`), `getReminderLeadTime(): number`, `setReminderLeadTime(ms: number): void`.

- [ ] **Step 1: Write the failing tests**

Create `src/notifications/reminderSettings.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getReminderLeadTime, setReminderLeadTime, REMINDER_LEAD_OPTIONS } from './reminderSettings';

describe('reminderSettings', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('exposes exactly the five allowed lead-time options', () => {
    expect(REMINDER_LEAD_OPTIONS).toEqual([0, 5 * 60 * 1000, 15 * 60 * 1000, 30 * 60 * 1000, 60 * 60 * 1000]);
  });

  describe('getReminderLeadTime', () => {
    it('returns 0 when nothing is stored', () => {
      expect(getReminderLeadTime()).toBe(0);
    });

    it('returns the stored value when it is a valid option', () => {
      localStorage.setItem('jotterpad-reminder-lead-ms', String(15 * 60 * 1000));
      expect(getReminderLeadTime()).toBe(15 * 60 * 1000);
    });

    it('falls back to 0 for a stored value outside the allowed options', () => {
      localStorage.setItem('jotterpad-reminder-lead-ms', '999999');
      expect(getReminderLeadTime()).toBe(0);
    });

    it('falls back to 0 for a non-numeric stored value', () => {
      localStorage.setItem('jotterpad-reminder-lead-ms', 'nonsense');
      expect(getReminderLeadTime()).toBe(0);
    });

    it('returns 0 when localStorage.getItem throws', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });
      expect(getReminderLeadTime()).toBe(0);
    });
  });

  describe('setReminderLeadTime', () => {
    it('persists the chosen value so it can be read back', () => {
      setReminderLeadTime(30 * 60 * 1000);
      expect(localStorage.getItem('jotterpad-reminder-lead-ms')).toBe(String(30 * 60 * 1000));
      expect(getReminderLeadTime()).toBe(30 * 60 * 1000);
    });

    it('does not throw when localStorage.setItem throws', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });
      expect(() => setReminderLeadTime(30 * 60 * 1000)).not.toThrow();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/notifications/reminderSettings.test.ts`
Expected: FAIL — `Cannot find module './reminderSettings'` (the module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/notifications/reminderSettings.ts`:

```ts
export const REMINDER_LEAD_OPTIONS: readonly number[] = [
  0,
  5 * 60 * 1000,
  15 * 60 * 1000,
  30 * 60 * 1000,
  60 * 60 * 1000,
];

const STORAGE_KEY = 'jotterpad-reminder-lead-ms';

function isValidLeadTime(value: number): boolean {
  return REMINDER_LEAD_OPTIONS.includes(value);
}

export function getReminderLeadTime(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return 0;
    const parsed = Number(raw);
    return isValidLeadTime(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

export function setReminderLeadTime(ms: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(ms));
  } catch {
    // Silently ignore localStorage errors, matching src/theme.ts's guard.
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/notifications/reminderSettings.test.ts`
Expected: PASS — all 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/notifications/reminderSettings.ts src/notifications/reminderSettings.test.ts
git commit -m "feat: add reminder lead-time storage module"
```

---

### Task 2: Apply Lead Time to Reminder Scheduling

**Files:**
- Modify: `src/notifications/reminders.ts`
- Modify: `src/notifications/reminders.test.ts`

**Interfaces:**
- Consumes: `getReminderLeadTime(): number` from `src/notifications/reminderSettings.ts` (Task 1).
- Produces: `scheduleEventReminders(events: Entry[]): void` (signature unchanged, behavior extended).

- [ ] **Step 1: Write the failing tests**

Add these three tests inside the existing `describe('reminders', ...)` block in `src/notifications/reminders.test.ts` (after the existing `'does not fire duplicate notifications...'` test, before the service-worker test). Also add the new import and a `localStorage.clear()` call to the existing `beforeEach`:

```ts
// Add to the existing import line:
import { requestNotificationPermission, scheduleEventReminders } from './reminders';
import { setReminderLeadTime } from './reminderSettings';
```

```ts
// Add as the first line inside the existing beforeEach(() => { ... }) body,
// so each test starts with the default 0ms lead time regardless of what a
// previous test configured:
localStorage.clear();
```

```ts
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
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run src/notifications/reminders.test.ts -t "shifts the scheduled notification earlier"`
Expected: FAIL — delay/body don't yet account for lead time (fires at the original 6-hour mark with body `'dentist'`, not `'dentist (at 6:00 PM)'` at 5h45m).

Run: `npx vitest run src/notifications/reminders.test.ts -t "pulls an event that is just past the 24-hour window"`
Expected: FAIL — the event is currently excluded entirely (24h10m > 24h window, unshifted).

- [ ] **Step 3: Write the implementation**

In `src/notifications/reminders.ts`, add the import and rewrite `scheduleEventReminders`:

```ts
import { Entry } from '../models/entry';
import { getReminderLeadTime } from './reminderSettings';
```

```ts
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
```

- [ ] **Step 4: Run the full reminders test file to verify everything passes**

Run: `npx vitest run src/notifications/reminders.test.ts`
Expected: PASS — all tests green, including the pre-existing ones (they still use the default 0ms lead time since `localStorage.clear()` now runs in `beforeEach`, so their notification bodies are unchanged plain event text).

- [ ] **Step 5: Commit**

```bash
git add src/notifications/reminders.ts src/notifications/reminders.test.ts
git commit -m "feat: apply configurable lead time to reminder scheduling"
```

---

### Task 3: Reminder Lead-Time Picker UI

**Files:**
- Modify: `src/components/ReminderSettings.tsx`
- Create: `src/components/ReminderSettings.test.tsx`

**Interfaces:**
- Consumes: `getReminderLeadTime(): number`, `setReminderLeadTime(ms: number): void` from `src/notifications/reminderSettings.ts` (Task 1).
- Produces: `ReminderSettings` now accepts an optional prop `onLeadTimeChange?: () => void`, called synchronously right after `setReminderLeadTime` on every click of a lead-time option.
- Reuses the existing `.theme-options` / `.theme-options button` / `.theme-options button.active` CSS classes already defined in `src/index.css` (from the theme feature) — no CSS changes needed in this task.

- [ ] **Step 1: Write the failing tests**

Create `src/components/ReminderSettings.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach } from 'vitest';
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
```

This test file needs `vi` for `vi.fn()` — add `vi` to the `vitest` import: `import { describe, it, expect, beforeEach, vi } from 'vitest';`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/ReminderSettings.test.tsx`
Expected: FAIL — none of the five lead-time buttons exist yet (`ReminderSettings` currently only renders "Enable reminders").

- [ ] **Step 3: Write the implementation**

Replace the full contents of `src/components/ReminderSettings.tsx`:

```tsx
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/ReminderSettings.test.tsx`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/ReminderSettings.tsx src/components/ReminderSettings.test.tsx
git commit -m "feat: add reminder lead-time picker UI"
```

---

### Task 4: Wire Immediate Rescheduling in App

**Files:**
- Modify: `src/App.tsx:586` (the `<ReminderSettings />` usage inside the Settings panel)
- Modify: `src/App.test.tsx`

**Interfaces:**
- Consumes: `ReminderSettings`'s `onLeadTimeChange?: () => void` prop (Task 3); `entriesRef: React.RefObject<Entry[]>` and `scheduleEventReminders(events: Entry[]): void`, both already present/imported in `App.tsx`.

- [ ] **Step 1: Write the failing test**

Add this test to `src/App.test.tsx`, near the existing `'reschedules reminders after entries change, not just once at initial load'` test (same file already imports `scheduleEventReminders` as a mock and has a `setPinThroughUi` helper in scope):

```tsx
  it('reschedules reminders immediately when the reminder lead time is changed in Settings', async () => {
    const user = userEvent.setup();
    render(<App />);
    await setPinThroughUi(user);

    await waitFor(() => expect(vi.mocked(scheduleEventReminders).mock.calls.length).toBeGreaterThan(0));
    const callsBeforeChange = vi.mocked(scheduleEventReminders).mock.calls.length;

    await user.click(await screen.findByRole('button', { name: 'Settings' }));
    await user.click(await screen.findByRole('button', { name: '15 min before' }));

    await waitFor(() =>
      expect(vi.mocked(scheduleEventReminders).mock.calls.length).toBeGreaterThan(callsBeforeChange)
    );
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/App.test.tsx -t "reschedules reminders immediately when the reminder lead time is changed"`
Expected: FAIL — `ReminderSettings` is currently rendered with no `onLeadTimeChange` prop, so clicking the option persists the setting but never calls `scheduleEventReminders` again.

- [ ] **Step 3: Write the implementation**

In `src/App.tsx`, change line 586 from:

```tsx
          <ReminderSettings />
```

to:

```tsx
          <ReminderSettings onLeadTimeChange={() => scheduleEventReminders(entriesRef.current)} />
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/App.test.tsx -t "reschedules reminders immediately when the reminder lead time is changed"`
Expected: PASS.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS — all test files green, no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat: reschedule reminders immediately when lead time changes in Settings"
```
