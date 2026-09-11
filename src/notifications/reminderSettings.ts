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
