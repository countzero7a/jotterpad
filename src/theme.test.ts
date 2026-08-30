import { describe, it, expect, beforeEach } from 'vitest';
import { getStoredTheme, applyTheme, setTheme } from './theme';

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  describe('getStoredTheme', () => {
    it('returns "auto" when nothing is stored', () => {
      expect(getStoredTheme()).toBe('auto');
    });

    it('returns the stored value when it is a valid theme', () => {
      localStorage.setItem('jotterpad-theme', 'blue');
      expect(getStoredTheme()).toBe('blue');
    });

    it('falls back to "auto" for an invalid stored value', () => {
      localStorage.setItem('jotterpad-theme', 'nonsense');
      expect(getStoredTheme()).toBe('auto');
    });
  });

  describe('applyTheme', () => {
    it('sets the data-theme attribute for light/dark/blue', () => {
      applyTheme('blue');
      expect(document.documentElement.getAttribute('data-theme')).toBe('blue');
    });

    it('removes the data-theme attribute for auto', () => {
      document.documentElement.setAttribute('data-theme', 'dark');
      applyTheme('auto');
      expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    });
  });

  describe('setTheme', () => {
    it('persists the choice and applies it', () => {
      setTheme('dark');
      expect(localStorage.getItem('jotterpad-theme')).toBe('dark');
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    it('persisting "auto" clears any explicit data-theme attribute', () => {
      setTheme('dark');
      setTheme('auto');
      expect(localStorage.getItem('jotterpad-theme')).toBe('auto');
      expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    });
  });
});
