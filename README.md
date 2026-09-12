# Jotterpad

A local-first, PIN-encrypted notes-and-calendar app that runs entirely in your browser — no account, no server, no cloud. It's a single, chat-style timeline for quick notes and events, installable as a Progressive Web App on desktop and mobile.

**Live app:** https://countzero7a.github.io/jotterpad/

## Why

Most note apps need an account and send your data to a server. Jotterpad doesn't — everything is stored encrypted, on your device, in your browser's local storage. If you want the same notes on two devices, you sync them by scanning a QR code between them, in person. Nothing ever touches the network.

That tradeoff is deliberate: no account and no cloud means no server to breach, but it also means **there is no password reset and no backup safety net except the ones you make yourself.** See [Backups](#backups--why-they-matter) below.

## Features

- **Unified timeline** — notes and calendar events in one chronological, chat-style feed.
- **Quick capture** — a single input with a Note/Event toggle, optional tags, and date/time fields for events.
- **Search & tag filters** — full-text search and tag chips, combinable.
- **PIN-encrypted storage** — a numeric PIN unlocks the app each time it's opened; all content is encrypted at rest (PBKDF2 + AES-256-GCM via the Web Crypto API).
- **Device-to-device sync via QR code** — no WiFi, no internet, no server. Two devices exchange an animated sequence of QR codes to merge their notes, with automatic conflict detection if both sides edited the same entry.
- **Encrypted backup export/import** — export all your data as an encrypted file, protected by your device PIN or a separate one-off passphrase.
- **Local reminders** — browser notifications for upcoming events, while the app is open. Choose how much advance notice you get: at event time, or 5/15/30 minutes/1 hour before.
- **Installable PWA** — add it to your home screen or desktop like a native app; works offline.
- **Themes** — Auto (follows system), Light, Dark, and Blue.

## Install

### Desktop (Chrome/Edge)

1. Open [the live app](https://countzero7a.github.io/jotterpad/).
2. Click the install icon in the address bar (or the menu → "Install Jotterpad…").
3. A standalone app window opens — that **is** the installed app. Set your PIN inside it the first time you use it.

To uninstall later: right-click the app icon (Start menu / dock) → Uninstall, or `chrome://apps` → right-click → Remove.

### Android (Chrome)

1. Open [the live app](https://countzero7a.github.io/jotterpad/).
2. Tap the menu (⋮) → **Add to Home screen** (or **Install app**).
3. Launch it from the home screen icon like any other app.

To uninstall: long-press the home screen icon → Uninstall.

### iOS (Safari)

1. Open [the live app](https://countzero7a.github.io/jotterpad/).
2. Tap Share → **Add to Home Screen**.

Note: on iOS, background notification delivery is not guaranteed when the app is fully closed — this is an iOS/Safari platform limitation, not specific to Jotterpad.

Installing is per-browser, per-device: if a colleague opens the same link, they install their own independent, empty copy — nothing about your data is shared just by sharing the link.

## Using it

- **Capture**: type in the bottom bar, toggle Note/Event, add tags, hit Add.
- **Find**: use the search box or tap tag chips to filter the timeline.
- **Edit/delete**: tap an entry to edit in place; delete marks it removed (propagates on next sync).
- **Sync two devices**: on both devices, open Settings → Sync, and follow the on-screen QR prompts — each device displays its changes for the other to scan, then roles swap.
- **Settings**: PIN, theme, backup export/import, and reminder preferences all live under the Settings panel.

## Backups — why they matter

Jotterpad has no cloud, so **your data lives only on the devices you've installed it on.** Clearing your browser's site data, uninstalling the browser, or switching to a different browser/device without syncing first will permanently delete it — there is no account to recover it from.

Use **Settings → Export Backup** periodically, and keep the file somewhere safe. It's an encrypted JSON file, so it can be attached to a note-to-self email, put in cloud storage, etc. — the file itself is meaningless without the PIN or passphrase used to create it.

**If you lose your PIN (and any backup passphrase), your data is permanently unrecoverable.** There is no reset mechanism, by design.

## Tech stack

- **React + Vite**, with `vite-plugin-pwa` for the service worker and installable manifest.
- **IndexedDB** (via [`idb`](https://github.com/jakearchibald/idb)) for encrypted local storage.
- **Web Crypto API** — PBKDF2 (600,000 iterations) for key derivation, AES-256-GCM for encryption.
- **[`qrcode`](https://github.com/soldair/node-qrcode)** for generating sync QR frames, **[`jsQR`](https://github.com/cozmo/jsQR)** for scanning them.
- **Vitest + Testing Library** for the test suite.
- Deployed as a static site to **GitHub Pages** via GitHub Actions.

## Development

```bash
npm install
npm run dev      # start the dev server
npm test         # run the test suite
npm run build    # production build
```

Pushing to `master` automatically deploys the `dist/` build to GitHub Pages (see `.github/workflows/deploy.yml`).

## Design docs

Full design specs and implementation plans for each feature are in [`docs/superpowers/`](docs/superpowers/), including the [original app design](docs/superpowers/specs/2026-07-23-jotterpad-design.md), the [theme support design](docs/superpowers/specs/2026-08-30-theme-support-design.md), and the [configurable reminder lead-time design](docs/superpowers/specs/2026-09-10-reminder-lead-time-design.md).
