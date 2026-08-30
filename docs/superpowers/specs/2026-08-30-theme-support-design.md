# Theme Support — Design Spec

## 1. Overview

Jotterpad currently has one visual style (from Task 16) that auto-follows the OS light/dark setting via `prefers-color-scheme`. This feature adds an explicit theme picker with four options — **Auto**, **Light**, **Dark**, **Blue** — so the user can override the OS setting or pick a distinct accent-color look, per device.

## 2. Scope

- In scope: a theme picker in Settings; three CSS palettes (Light, Dark, Blue) plus an Auto mode that preserves today's OS-following behavior; persistence of the choice on the current device; applying the theme before the PIN lock screen renders (no flash of the wrong theme).
- Out of scope: syncing the theme choice between devices (via QR or backup) — it's a per-device UI preference, not user data, and is deliberately excluded from both. Additional themes beyond these four. Per-element/custom theming.

## 3. Storage

The theme choice is stored in `localStorage` under the key `jotterpad-theme`, with a value of `'auto' | 'light' | 'dark' | 'blue'`, defaulting to `'auto'` when unset or invalid.

This is `localStorage`, not the encrypted IndexedDB store used for notes/events/settings gated behind the PIN. A color preference is not sensitive data, and storing it unencrypted lets the correct theme apply immediately on load — including on the PIN lock screen itself — without waiting for the user to unlock first (which would otherwise cause a visible flash of the default theme before switching to the saved one).

## 4. Application

A small module (`src/theme.ts`) exports:
- `getStoredTheme(): Theme` — reads and validates the `localStorage` value, falling back to `'auto'`.
- `applyTheme(theme: Theme): void` — sets `document.documentElement.dataset.theme = theme` when the theme is `'light' | 'dark' | 'blue'`, or removes the `data-theme` attribute entirely when `'auto'` (so the existing `prefers-color-scheme` media query takes over unmodified).
- `setTheme(theme: Theme): void` — writes the choice to `localStorage` and calls `applyTheme`.

`applyTheme(getStoredTheme())` is called once at the top of `src/main.tsx`, before React renders — this is what prevents the flash, since the `data-theme` attribute is set on `<html>` synchronously before any component (including `LockScreen`) paints.

## 5. CSS

`src/index.css` keeps its existing `:root { ... }` block (today's light-mode defaults) and `@media (prefers-color-scheme: dark) { :root { ... } }` block exactly as-is — together these remain the behavior for `data-theme="auto"` (no attribute set) or when a user's OS/browser doesn't support the attribute at all.

Three new attribute-selector blocks are added, each overriding the same set of CSS custom properties regardless of OS setting:
- `:root[data-theme="light"]` — identical values to today's default `:root` block, explicit.
- `:root[data-theme="dark"]` — identical values to today's `@media (prefers-color-scheme: dark)` block, explicit.
- `:root[data-theme="blue"]` — light surfaces (same `--bg`/`--fg`/`--surface`/`--border` as Light), with `--accent` changed to a distinct blue and used consistently everywhere it already is today (buttons, active tag chips, event entry borders, focus states).

Because every themeable surface in the app already reads from these CSS custom properties (established in Task 16), no component styling changes are needed — only the variable *values* differ per theme.

## 6. UI

A new `ThemeSettings` component renders in the existing Settings panel (alongside `ExportSettings`, `ImportBackup`, `ReminderSettings`), four buttons — Auto / Light / Dark / Blue — with the currently-active one visually highlighted (reusing the existing `.tag.active`-style active-state pattern already used for tag filter chips, for visual consistency). Clicking a button calls `setTheme(...)` immediately — no save/confirm step, matching the rest of Settings' immediate-effect pattern (e.g. the resend-everything button).

## 7. Explicitly Out of Scope

- The theme choice is never included in QR sync bundles or backup exports — confirmed by not touching `Entry`, `mergeEntries`, `SyncBundle`, or `BackupFile` in any way. It lives entirely in `localStorage`, which `createBackup`/`prepareOutgoingBundle` never read from.
- No "custom theme" / color picker — only the four named options.
- No transition animation between themes — an instant switch is acceptable.
