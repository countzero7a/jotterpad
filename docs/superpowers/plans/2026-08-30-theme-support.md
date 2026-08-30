# Theme Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Auto/Light/Dark/Blue theme picker to Jotterpad, stored per-device in `localStorage` and applied before first paint so there's no flash of the wrong theme on the PIN lock screen.

**Architecture:** A small pure module (`src/theme.ts`) owns reading/writing the theme choice and toggling a `data-theme` attribute on `<html>`. Three new CSS blocks extend the existing custom-property system (from a prior task) to respond to that attribute. A `ThemeSettings` component in the existing Settings panel lets the user change it.

**Tech Stack:** No new dependencies — plain `localStorage`, CSS custom properties, existing React/Vitest/Testing Library setup.

## Global Constraints

- The theme choice lives in `localStorage`, never in the encrypted IndexedDB store, and is never included in QR sync bundles or backup exports — it's a per-device UI preference, not user data.
- `'auto'` must reproduce exactly today's behavior (no `data-theme` attribute set, `@media (prefers-color-scheme: dark)` decides).
- The theme must apply before React renders, so the PIN lock screen itself reflects the chosen theme with no flash.
- The "Blue" theme keeps the same `--bg`/`--fg`/`--surface`/`--border` values as Light; only `--accent` changes.

---

## Task 1: Theme Module and CSS

**Files:**
- Create: `src/theme.ts`
- Test: `src/theme.test.ts`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: nothing (pure module — only `localStorage`/`document.documentElement`, both available in jsdom).
- Produces: `type Theme = 'auto' | 'light' | 'dark' | 'blue'`; `getStoredTheme(): Theme`; `applyTheme(theme: Theme): void`; `setTheme(theme: Theme): void`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/theme.test.ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- theme`
Expected: FAIL — `src/theme.ts` does not exist yet.

- [ ] **Step 3: Write `src/theme.ts`**

```ts
export type Theme = 'auto' | 'light' | 'dark' | 'blue';

const STORAGE_KEY = 'jotterpad-theme';
const VALID_THEMES: readonly Theme[] = ['auto', 'light', 'dark', 'blue'];

function isTheme(value: string | null): value is Theme {
  return value !== null && (VALID_THEMES as readonly string[]).includes(value);
}

export function getStoredTheme(): Theme {
  const raw = localStorage.getItem(STORAGE_KEY);
  return isTheme(raw) ? raw : 'auto';
}

export function applyTheme(theme: Theme): void {
  if (theme === 'auto') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

export function setTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- theme`
Expected: PASS (7 tests)

- [ ] **Step 5: Add the three theme CSS blocks to `src/index.css`**

The file currently starts with:

```css
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --fg: #1c1c1e;
  --muted: #6b6b70;
  --border: #e0e0e2;
  --accent: #2f6fed;
  --danger: #d33;
  --surface: #f5f5f7;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1c1c1e;
    --fg: #f2f2f2;
    --muted: #9a9a9e;
    --border: #333336;
    --accent: #6ea2ff;
    --danger: #ff6b6b;
    --surface: #2a2a2d;
  }
}
```

Leave both of those blocks exactly as they are — together they remain the `data-theme="auto"` behavior. Immediately after the `@media` block (and before the `* { box-sizing: border-box; }` rule that follows it), insert three new blocks:

```css
:root[data-theme='light'] {
  --bg: #ffffff;
  --fg: #1c1c1e;
  --muted: #6b6b70;
  --border: #e0e0e2;
  --accent: #2f6fed;
  --danger: #d33;
  --surface: #f5f5f7;
}

:root[data-theme='dark'] {
  --bg: #1c1c1e;
  --fg: #f2f2f2;
  --muted: #9a9a9e;
  --border: #333336;
  --accent: #6ea2ff;
  --danger: #ff6b6b;
  --surface: #2a2a2d;
}

:root[data-theme='blue'] {
  --bg: #ffffff;
  --fg: #1c1c1e;
  --muted: #6b6b70;
  --border: #e0e0e2;
  --accent: #1565c0;
  --danger: #d33;
  --surface: #f0f5ff;
}
```

`light` and `dark` are byte-for-byte the same variable values as the existing default/`@media` blocks, just made explicit for when the OS setting should be overridden. `blue` keeps Light's `--bg`/`--fg`/`--muted`/`--border`/`--danger`, changes `--accent` to a distinct blue, and gives `--surface` a very slight blue tint so cards/buttons read as part of the theme rather than identical to plain Light.

- [ ] **Step 6: Run the full suite to confirm nothing broke**

Run: `npm test`
Expected: PASS — no component class names or markup changed, so no existing test should be affected by adding CSS blocks.

- [ ] **Step 7: Commit**

```bash
git add src/theme.ts src/theme.test.ts src/index.css
git commit -m "feat: add theme module and Light/Dark/Blue CSS palettes"
```

---

## Task 2: Theme Settings UI and Wiring

**Files:**
- Create: `src/components/ThemeSettings.tsx`
- Test: `src/components/ThemeSettings.test.tsx`
- Modify: `src/index.css`
- Modify: `src/main.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Consumes: `Theme`, `getStoredTheme`, `setTheme` from `src/theme.ts` (Task 1).
- Produces: `ThemeSettings()` — a component with no props, rendered inside the Settings panel.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/ThemeSettings.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach } from 'vitest';
import { ThemeSettings } from './ThemeSettings';

describe('ThemeSettings', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('renders all four theme options', () => {
    render(<ThemeSettings />);
    expect(screen.getByRole('button', { name: 'Auto' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Light' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dark' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Blue' })).toBeInTheDocument();
  });

  it('highlights Auto as active by default', () => {
    render(<ThemeSettings />);
    expect(screen.getByRole('button', { name: 'Auto' })).toHaveClass('active');
    expect(screen.getByRole('button', { name: 'Blue' })).not.toHaveClass('active');
  });

  it('applies and persists the selected theme immediately on click', async () => {
    const user = userEvent.setup();
    render(<ThemeSettings />);
    await user.click(screen.getByRole('button', { name: 'Blue' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('blue');
    expect(localStorage.getItem('jotterpad-theme')).toBe('blue');
    expect(screen.getByRole('button', { name: 'Blue' })).toHaveClass('active');
    expect(screen.getByRole('button', { name: 'Auto' })).not.toHaveClass('active');
  });

  it('reflects an already-stored theme on mount', () => {
    localStorage.setItem('jotterpad-theme', 'dark');
    render(<ThemeSettings />);
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveClass('active');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- ThemeSettings`
Expected: FAIL — `src/components/ThemeSettings.tsx` does not exist yet.

- [ ] **Step 3: Write `src/components/ThemeSettings.tsx`**

```tsx
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- ThemeSettings`
Expected: PASS (4 tests)

- [ ] **Step 5: Style `.theme-options` in `src/index.css`**

Append this block to the end of `src/index.css`:

```css
.theme-options {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.theme-options button {
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 13px;
}

.theme-options button.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
```

This mirrors the visual look already used for the tag filter chips (pill-shaped, accent-filled when active) without depending on `.tag-filter-bar`'s ancestor-scoped selectors, since `ThemeSettings` renders outside that component.

- [ ] **Step 6: Apply the stored theme before React renders, in `src/main.tsx`**

Current content:

```tsx
import './index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

Replace with:

```tsx
import './index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { applyTheme, getStoredTheme } from './theme';

applyTheme(getStoredTheme());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

`main.tsx` has no existing test file in this project (it's bootstrapping code, verified manually/via the browser) — this step is checked in Step 9's manual verification, not a unit test.

- [ ] **Step 7: Render `ThemeSettings` in the Settings panel, in `src/App.tsx`**

Add the import alongside the other component imports near the top of the file:

```tsx
import { ThemeSettings } from './components/ThemeSettings';
```

In the Settings panel JSX, `<ReminderSettings />` is currently followed directly by the "Resend everything on next sync" `<div>`. Add `<ThemeSettings />` between them:

```tsx
          <ReminderSettings />
          <ThemeSettings />
          <div>
            <button
              onClick={() => {
                setResendConfirmed(false);
                handleResendEverything();
              }}
            >
```

- [ ] **Step 8: Write the failing App-level wiring test**

Add to `src/App.test.tsx` (this file already has a `setPinThroughUi` helper used by other tests — reuse it):

```tsx
it('lets the user pick a theme from Settings, applying it immediately', async () => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  const user = userEvent.setup();
  render(<App />);
  await setPinThroughUi(user);

  await user.click(await screen.findByRole('button', { name: 'Settings' }));
  await user.click(screen.getByRole('button', { name: 'Blue' }));

  expect(document.documentElement.getAttribute('data-theme')).toBe('blue');
  expect(localStorage.getItem('jotterpad-theme')).toBe('blue');
});
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm test -- App`
Expected: PASS (check the file's current test count first — this adds 1)

- [ ] **Step 10: Run the full suite, typecheck, and build**

Run: `npm test && npx tsc --noEmit -p tsconfig.json && npm run build`
Expected: all pass, zero type errors, build succeeds.

- [ ] **Step 11: Commit**

```bash
git add src/components/ThemeSettings.tsx src/components/ThemeSettings.test.tsx src/index.css src/main.tsx src/App.tsx src/App.test.tsx
git commit -m "feat: add theme picker to Settings, wired end to end"
```

- [ ] **Step 12: Manual verification**

Run: `npm run build && npm run dev`

In a browser: open Settings and confirm the Theme section shows four buttons with "Auto" highlighted by default. Click Dark — confirm the whole app (including the header, capture bar, and entry cards) switches immediately. Click Blue — confirm accent-colored buttons/active tag chips/event borders turn blue while backgrounds stay light. Reload the page — confirm the chosen theme persists and applies before the lock screen itself is visible (no flash of the previous theme). Click Auto — confirm it reverts to following the OS/browser's light/dark setting (toggle your OS theme or force `prefers-color-scheme` via devtools to confirm).

---

## Self-Review Notes

- **Spec coverage:** Storage (§3) → Task 1 Step 3. Application/no-flash (§4) → Task 2 Step 6. CSS (§5) → Task 1 Step 5, Task 2 Step 5. UI (§6) → Task 2 Steps 3, 7. Out of scope (§7) — confirmed no task touches `Entry`, `mergeEntries`, `SyncBundle`, `BackupFile`, or any encrypted storage path; the module only touches `localStorage` and `document.documentElement`.
- **Placeholder scan:** no TBD/TODO; every step has runnable code.
- **Type consistency:** `Theme` (Task 1) is used identically in `ThemeSettings.tsx` (Task 2) and the new `App.test.tsx` test. `getStoredTheme`/`applyTheme`/`setTheme` signatures match their Task 1 definitions everywhere they're called in Task 2.
