export type ReminderLeadTime = 0 | 300000 | 900000 | 1800000 | 3600000;

// Values must be written as numeric literals (not arithmetic expressions like
// `5 * 60 * 1000`): TypeScript does not narrow the result of an arithmetic
// expression down to a literal type, so an expression here would fail to
// satisfy the ReminderLeadTime union and defeat the compile-time drift check.
export const REMINDER_LEAD_OPTIONS: readonly ReminderLeadTime[] = [
  0, // at event time
  300000, // 5 minutes
  900000, // 15 minutes
  1800000, // 30 minutes
  3600000, // 1 hour
];

const STORAGE_KEY = 'jotterpad-reminder-lead-ms';

function isValidLeadTime(value: number): boolean {
  return REMINDER_LEAD_OPTIONS.includes(value as ReminderLeadTime);
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

export function setReminderLeadTime(ms: ReminderLeadTime): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(ms));
  } catch {
    // Silently ignore localStorage errors, matching src/theme.ts's guard.
  }
}
