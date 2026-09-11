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
      setReminderLeadTime(1800000); // 30 minutes
      expect(localStorage.getItem('jotterpad-reminder-lead-ms')).toBe(String(30 * 60 * 1000));
      expect(getReminderLeadTime()).toBe(30 * 60 * 1000);
    });

    it('does not throw when localStorage.setItem throws', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });
      expect(() => setReminderLeadTime(1800000)).not.toThrow(); // 30 minutes
    });
  });
});
