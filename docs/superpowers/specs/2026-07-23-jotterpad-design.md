# Jotterpad — Design Spec

## 1. Overview

Jotterpad is an installable Progressive Web App (PWA) for quick-capture notes and calendar events, presented as a single unified, chat-style timeline. It runs on both desktop and mobile browsers from one codebase.

There is no account and no server of any kind. Each device stores its own data locally and encrypted. Two devices can be kept in sync by directly exchanging QR codes when physically together — no WiFi, internet, or third-party infrastructure is involved in syncing.

Priorities, in order: privacy/no-account, simplicity, and an accepted amount of manual friction (PIN entry, QR scanning) in exchange for those guarantees.

## 2. Architecture

- **Single-page app**, no backend. All logic runs client-side.
- **Local storage**: browser IndexedDB holds all notes and events, per device, encrypted at rest.
- **Sync engine**: on-demand, QR-code-based, two-pass exchange. No networking involved — camera-only, optical data transfer.
- **Notifications**: browser's local Notification API for event reminders, scoped to while the app is open/running.

## 3. Security

- On first launch per device, the user sets a **numeric PIN**.
  - **Accepted tradeoff**: a numeric PIN is fast to type (matches the "quick capture" goal) but is brute-forceable offline in practical time if an attacker extracts the raw encrypted database file directly (as opposed to just picking up an unlocked device). This was discussed explicitly and accepted in favor of speed. A passphrase would resist offline brute-forcing far better, but was declined for the extra typing friction.
- The PIN + a random per-device salt are run through PBKDF2 (high iteration count, e.g. 600,000+ per current OWASP guidance) to derive an AES-256-GCM key.
- All note/event content is encrypted at rest in IndexedDB with that key; nothing sits as plaintext on disk. The salt is stored unencrypted (required to re-derive the key on each unlock) but is useless without the PIN.
- **Unlock timing**: required once per app open ("only when reopened"); stays unlocked for that session; no additional inactivity timeout.
- **Exported backups**: at export time, the user chooses either to reuse the device PIN or set a one-off passphrase for that specific file. This lets rarely-typed backup files use a stronger secret than the frequently-typed device PIN, without forcing that friction onto daily use.
- **Unrecoverability warning**: any screen where a PIN or passphrase is set (initial device PIN setup, backup export passphrase entry) must show a clear, visible warning that if the PIN/passphrase is lost, the associated data is permanently unrecoverable — there is no account and no reset mechanism.

## 4. Data Model

**Entry** — unified type for both notes and events, stored encrypted in IndexedDB:

| Field | Notes |
|---|---|
| `id` | UUID, generated on creation |
| `type` | `note` \| `event` |
| `text` | free text content |
| `tags[]` | user-entered tags, freeform |
| `eventDate` / `eventTime` | present only for `type: event` |
| `linkedNoteId` | optional, for an event with an attached note |
| `createdAt`, `modifiedAt` | timestamps |
| `deviceId` | which device last modified this entry |
| `deleted`, `deletedAt` | tombstone fields — deletions propagate via sync instead of the item reappearing from the other device's copy |

## 5. Sync Protocol

Sync is **on-demand** (user-triggered) and **two-pass**, since there's no persistent connection or server:

1. Both devices must be **unlocked** (PIN entered) so content is decrypted in memory before syncing.
2. Device A computes all entries added/modified/deleted since the last recorded sync timestamp with Device B, serializes them as a JSON bundle, and — if the bundle is larger than a single QR code can hold — chunks it into a sequence of frames (each frame tagged with `{seq, total, sessionId}`), displayed as an animated sequence on screen.
3. Device B's camera scans the sequence (via `jsQR`), reassembles the chunks, and merges the entries into its own store.
4. Roles reverse: Device B now shows its own changes since the last sync, Device A scans.
5. **Merge logic**:
   - New entries (new IDs on either side): union in directly.
   - Deletions: tombstones apply, removing the entry from the merged view regardless of which side deleted it.
   - If only one side modified a given entry since the last recorded sync: that version wins, no prompt.
   - If **both** sides modified the same entry since the last recorded sync, with different resulting content: flagged as a **conflict**, both versions are shown to the user, who picks one or merges manually.
6. Each device records the timestamp of the last successful sync with the other device, used to compute "changed since" on the next sync.
7. **First sync between a pair of devices**: with no prior recorded sync timestamp, all local entries (not just recent ones) are treated as "changed" and included in that device's first QR bundle — i.e. the first sync is always a full merge.

QR payloads are not separately encrypted beyond the device's own PIN-derived encryption of the underlying data before it's serialized for transfer — the transfer itself is only visible in person, for the brief duration of the live scan, to someone who is already physically present with both devices. This is treated as an accepted, low residual risk relative to the primary lost/stolen-device threat model.

## 6. UI/UX

- **Layout**: chat-style unified timeline. Past notes/events scroll upward in chronological order. A capture bar is pinned at the bottom of the screen (mobile and desktop alike).
- **Future events**: shown inline, positioned below today's entries and above the capture bar, in chronological order — scrolling down from "today" reveals what's upcoming.
- **Capture bar**: a single text input with an explicit Note/Event toggle. Event mode reveals date/time fields. Either mode supports optional tags.
- **Top bar**: sync icon (triggers the QR exchange flow), search box (full-text), and tag filter chips.
- **Finding entries**: tag chips filter the feed; the search box matches text content. The two work together (combinable filters).
- **Editing/deleting**: tap an entry to edit in place. A delete action marks the entry as a tombstone (soft delete, propagates via sync).
- **Lock screen**: PIN entry gate shown before any content renders on app open. PIN setup screen carries the unrecoverability warning (see Security).
- **Export/Backup**: a settings action exports all entries as an encrypted JSON file. At export time, the user chooses "use device PIN" or "set a one-off passphrase for this file" (with the unrecoverability warning shown either way). Import reverses this, prompting for whichever secret was used to encrypt that specific file.
- **Reminders**: local browser notifications fire for events while the app/tab is open or running in the background, per the browser's own support. Not guaranteed to fire if the app is fully closed, especially on iOS. This caveat is shown explicitly in settings, not left implicit.

## 7. Tech Stack

- **Framework**: React + Vite, with `vite-plugin-pwa` for the service worker and manifest (installable on desktop and mobile; works fully offline since there's no backend to reach anyway).
- **Storage**: IndexedDB via a thin wrapper (e.g. `idb`), holding encrypted blobs.
- **Crypto**: native Web Crypto API — PBKDF2 for key derivation from the PIN/passphrase, AES-256-GCM for encryption/decryption. No external crypto library.
- **QR generation**: `qrcode` (renders frames to canvas/SVG).
- **QR scanning**: camera access via `getUserMedia`, decoding via `jsQR` — chosen over the native `BarcodeDetector` API specifically because Safari/iOS doesn't support `BarcodeDetector`, and iOS support matters here.
- **Deployment**: fully static, no backend — deployable to any static host, or simply run and installed locally.

## 8. Testing Approach

- **Highest priority for automated tests**: the merge/conflict resolution logic (union, tombstones, last-write-wins, conflict detection) and the encrypt/decrypt roundtrip (PBKDF2 key derivation + AES-GCM), since correctness here directly protects data integrity and security.
- **Manual verification**: the QR display/scan flow, since it requires a real camera and a second physical device and is impractical to automate meaningfully. Verified by hand across two real devices as part of implementation.

## Explicitly Out of Scope

- Cloud accounts, cloud sync, or any third-party server involvement.
- Pairing/sync over WiFi, Bluetooth, or any network transport (QR-only, by design).
- PIN/passphrase recovery — loss means the data is permanently unrecoverable, by design (no account exists to reset against).
- Guaranteed reminder delivery when the app is fully closed (browser/OS limitation, most notable on iOS).
- Syncing across more than two devices in a single exchange (each sync is a pairwise exchange between two devices; nothing here prevents running multiple pairwise syncs, but that flow isn't designed for >2 devices at once).
