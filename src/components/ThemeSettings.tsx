import { useState } from 'react';
import { Theme, getStoredTheme, setTheme } from '../theme';

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'blue', label: 'Blue' },
];

export function ThemeSettings() {
  const [current, setCurrent] = useState<Theme>(getStoredTheme);

  function handleSelect(theme: Theme) {
    setTheme(theme);
    setCurrent(theme);
  }

  return (
    <div className="theme-settings">
      <h2>Theme</h2>
      <div className="theme-options">
        {THEME_OPTIONS.map(({ value, label }) => (
          <button
            key={value}
            className={current === value ? 'active' : undefined}
            onClick={() => handleSelect(value)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
