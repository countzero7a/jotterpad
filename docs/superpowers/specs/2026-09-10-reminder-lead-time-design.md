# Configurable Reminder Lead-Time — Design Spec

## 1. Overview

Jotterpad's event reminders (Task 13) currently fire a local browser notification at the exact event time, and only if the event falls within 24 hours when the reminder-scheduling logic runs. There is no way to be notified *before* an event happens. This feature adds a single, global "notify me X before" setting so reminders can give advance notice instead of firing exactly at the moment the event starts.

## 2. Scope

- In scope: one global, device-local lead-time setting with five options (at event time, 5/15/30 minutes, 1 hour before); applying it to the existing reminder-scheduling logic; a UI control in the existing Reminders settings section; adjusting notification text when the lead time is non-zero.
- Out of scope: per-event lead-time customization; syncing the setting between devices; any change to whether/how notification permission is requested; any change to the existing 24-hour scheduling window or hourly rescan mechanism, beyond what's the "trigger point" is measured against.

## 3. Storage

The lead time is stored in `localStorage` under the key `jotterpad-reminder-lead-ms`, as one of five valid millisecond values: `0`, `300000` (5 min), `900000` (15 min), `1800000` (30 min), `3600000` (1 hour). Missing or invalid values fall back to `0` ("at event time" — today's existing behavior).

This mirrors the existing theme preference (`src/theme.ts`): it's a device-local notification/UI preference, not user content, so it is **not** included in QR sync bundles or backup exports. Two devices may have different lead times.

A new module, `src/notifications/reminderSettings.ts`, exports:
- `getReminderLeadTime(): number` — reads and validates the stored value, falling back to `0`.
- `setReminderLeadTime(ms: number): void` — writes the value to `localStorage`.

Both wrap `localStorage` access in `try/catch`, matching `theme.ts`'s guard against a throwing `localStorage` (e.g. private browsing modes that disable it).

## 4. Scheduling Change

In `scheduleEventReminders` (`src/notifications/reminders.ts`), the trigger point shifts from the event's own timestamp to `eventTimestamp - getReminderLeadTime()`. The existing window check (`delay > 0 && delay < 24 * 60 * 60 * 1000`) is unchanged — it now applies to this shifted "notify at" time rather than the event time itself, so the existing 24-hour window and hourly rescan (`App.tsx`) continue to work unmodified.

If the lead time would push the notify time into the past — i.e. the event is sooner than the configured lead time — no reminder is scheduled for that event. There is no fallback to a late/immediate notification; this keeps the logic simple and matches the existing "don't schedule what's already past" behavior.

`getReminderLeadTime()` is read once per `scheduleEventReminders` call (it's a single global value, not per-event).

## 5. Notification Text

- When the lead time is `0`: notification body is unchanged — just the event's text, exactly as today.
- When the lead time is `> 0`: notification body becomes `"<event text> (at <event's local time>)"`, formatting the same `when` `Date` already computed for scheduling (event date + `eventTime`, with the existing `'00:00'` fallback for events with no time) via `toLocaleTimeString` (e.g. `"Pick up dry cleaning (at 3:00 PM)"`). This clarifies that the event itself hasn't started yet when the notification arrives early. The notification title (`"Jotterpad reminder"`) is unchanged.

## 6. UI

`ReminderSettings.tsx` gains a button group below its existing explanatory text and "Enable reminders" button, styled like the existing `.theme-options` pattern (five buttons: "At event time", "5 min before", "15 min before", "30 min before", "1 hour before"), with the active option highlighted. Clicking a button calls `setReminderLeadTime(...)` and immediately reschedules pending reminders — no save/confirm step, consistent with the rest of Settings.

To reschedule immediately, `ReminderSettings` accepts a new optional `onLeadTimeChange: () => void` prop, called right after `setReminderLeadTime`. `App.tsx` passes `() => scheduleEventReminders(entriesRef.current)` (the same ref-based call already used by the existing hourly rescan effect, so it reflects live entries rather than a stale render closure).

## 7. Testing

- New tests for `reminderSettings.ts` mirroring `theme.test.ts`'s coverage: default fallback when unset, validation of a stored value against the five allowed options, fallback on an invalid/corrupt stored value, and behavior when `localStorage` throws.
- Extend `reminders.test.ts` to cover: the scheduling delay shifts earlier by the configured lead time; since shifting the trigger point earlier can only pull an event into the 24-hour window (from being too far away) or push it into the past (from being too soon), not push it beyond the window's far edge, cover both of those real boundary cases — an event whose notify time is pulled into the window from just outside it, and one whose notify time is pushed into the past by a lead time larger than its remaining time; the notification body includes the formatted event time when lead time is non-zero and excludes it when zero.
- New test in `ReminderSettings.test.tsx` (new file, following the pattern of `TagFilterBar.test.tsx`/`ThemeSettings.test.tsx`) verifying the button group renders, clicking a button calls `setReminderLeadTime` and the `onLeadTimeChange` callback, and the active button reflects the current stored value on mount.

## 8. Explicitly Out of Scope

- Per-event lead-time overrides.
- Syncing the lead-time setting via QR or backup — confirmed by not touching `Entry`, `mergeEntries`, `SyncBundle`, or `BackupFile`.
- Changing the 24-hour scheduling window itself, or the hourly rescan interval.
- Any change to notification permission requesting/handling.
