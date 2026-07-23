# Jotterpad Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Jotterpad, an installable PWA for quick-capture notes and calendar events in a single unified chat-style timeline, with PIN-encrypted local storage and QR-code-based device-to-device sync (no accounts, no servers, no networking of any kind).

**Architecture:** A single-page React app with no backend. All entries live encrypted in IndexedDB. A PIN gate derives the encryption key each session. Syncing between two devices is a manual, two-pass, camera-based QR exchange — one device displays an animated QR sequence of its changes, the other scans and merges, then roles reverse.

**Tech Stack:** React + Vite + TypeScript, `vite-plugin-pwa`, `idb` (IndexedDB wrapper), native Web Crypto API (PBKDF2 + AES-256-GCM), `qrcode` (generate), `jsqr` (scan), Vitest + `@testing-library/react` + `fake-indexeddb` for tests.

## Global Constraints

- No backend server or third-party network involvement anywhere in the app — sync is QR-only, camera-based, and works with networking off.
- All note/event content must be encrypted at rest (AES-256-GCM, key derived via PBKDF2) before touching IndexedDB — nothing stored as plaintext.
- Device unlock uses a numeric PIN only, not a passphrase — an accepted, deliberate tradeoff favoring speed over resistance to offline brute-forcing, per spec Section 3.
- Any screen that sets a PIN or passphrase (device PIN setup, backup export) must display a clear warning that loss means the data is permanently unrecoverable.
- QR scanning must work without the native `BarcodeDetector` API (use `jsQR`) since Safari/iOS doesn't support it.
- Reminders only need to fire while the app is open/running; not guaranteed when fully closed — but that caveat must be visible in Settings, not left implicit.
- The first sync between a pair of devices is always a full merge (there is no prior `lastSyncAt`).
- Exported backups are encrypted with either the device PIN or a separate one-off passphrase, chosen at export time — never plaintext.

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/App.test.tsx`
- Create: `src/test/setup.ts`

**Interfaces:**
- Produces: a running Vite dev server and a Vitest test runner; `App` component (placeholder, replaced fully in Task 14).

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "jotterpad",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "idb": "^8.0.0",
    "qrcode": "^1.5.4"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.8",
    "@testing-library/react": "^16.0.1",
    "@testing-library/user-event": "^14.5.2",
    "@types/qrcode": "^1.5.5",
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "fake-indexeddb": "^6.0.0",
    "jsdom": "^25.0.0",
    "typescript": "^5.5.4",
    "vite": "^5.4.2",
    "vite-plugin-pwa": "^0.20.1",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Jotterpad',
        short_name: 'Jotterpad',
        theme_color: '#1c1c1e',
        background_color: '#1c1c1e',
        display: 'standalone',
        icons: [],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
  },
});
```

- [ ] **Step 4: Write `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Jotterpad</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Write `src/test/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
```

- [ ] **Step 6: Write `src/main.tsx`**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 7: Write the failing test `src/App.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import App from './App';

describe('App', () => {
  it('renders the Jotterpad heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Jotterpad' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Install dependencies and run the test to verify it fails**

Run: `npm install && npm test`
Expected: FAIL — `src/App.tsx` does not exist yet, or the heading isn't found.

- [ ] **Step 9: Write minimal `src/App.tsx`**

```tsx
export default function App() {
  return <h1>Jotterpad</h1>;
}
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add package.json tsconfig.json vite.config.ts index.html src/main.tsx src/App.tsx src/App.test.tsx src/test/setup.ts package-lock.json
git commit -m "chore: scaffold Vite + React + TS + Vitest + PWA project"
```

---

## Task 2: Crypto Module

**Files:**
- Create: `src/crypto/crypto.ts`
- Test: `src/crypto/crypto.test.ts`

**Interfaces:**
- Produces: `deriveKey(secret: string, saltBase64?: string): Promise<{ key: CryptoKey; salt: string }>`, `encrypt(key: CryptoKey, plaintext: string): Promise<string>`, `decrypt(key: CryptoKey, combined: string): Promise<string>`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/crypto/crypto.test.ts
import { describe, it, expect } from 'vitest';
import { deriveKey, encrypt, decrypt } from './crypto';

describe('crypto', () => {
  it('round-trips plaintext through encrypt/decrypt', async () => {
    const { key } = await deriveKey('1234');
    const combined = await encrypt(key, 'hello jotterpad');
    const result = await decrypt(key, combined);
    expect(result).toBe('hello jotterpad');
  });

  it('derives the same key from the same secret and salt', async () => {
    const first = await deriveKey('1234');
    const second = await deriveKey('1234', first.salt);
    const combined = await encrypt(first.key, 'shared secret data');
    const result = await decrypt(second.key, combined);
    expect(result).toBe('shared secret data');
  });

  it('fails to decrypt with a key derived from a different secret', async () => {
    const { key: keyA } = await deriveKey('1234');
    const { salt } = await deriveKey('1234');
    const { key: keyB } = await deriveKey('9999', salt);
    const combined = await encrypt(keyA, 'protected');
    await expect(decrypt(keyB, combined)).rejects.toThrow();
  });

  it('produces a different ciphertext each time due to a random IV', async () => {
    const { key } = await deriveKey('1234');
    const a = await encrypt(key, 'same text');
    const b = await encrypt(key, 'same text');
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- crypto`
Expected: FAIL — `src/crypto/crypto.ts` does not exist yet.

- [ ] **Step 3: Write `src/crypto/crypto.ts`**

```ts
const PBKDF2_ITERATIONS = 600_000;

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

export interface DerivedKey {
  key: CryptoKey;
  salt: string;
}

export async function deriveKey(secret: string, saltBase64?: string): Promise<DerivedKey> {
  const salt = saltBase64 ? fromBase64(saltBase64) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  return { key, salt: toBase64(salt) };
}

export async function encrypt(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return toBase64(combined);
}

export async function decrypt(key: CryptoKey, combined: string): Promise<string> {
  const bytes = fromBase64(combined);
  const iv = bytes.slice(0, 12);
  const ciphertext = bytes.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- crypto`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/crypto/crypto.ts src/crypto/crypto.test.ts
git commit -m "feat: add PBKDF2/AES-GCM crypto module"
```

---

## Task 3: Entry Model

**Files:**
- Create: `src/models/entry.ts`
- Test: `src/models/entry.test.ts`

**Interfaces:**
- Consumes: nothing (pure module, only uses `crypto.randomUUID`).
- Produces: `type EntryType = 'note' | 'event'`; `interface Entry { id, type, text, tags, eventDate?, eventTime?, linkedNoteId?, createdAt, modifiedAt, deviceId, deleted, deletedAt? }`; `parseTags(raw: string): { text: string; tags: string[] }`; `createNote(rawText: string, deviceId: string): Entry`; `createEvent(rawText: string, eventDate: string, eventTime: string | undefined, deviceId: string, linkedNoteId?: string): Entry`; `markDeleted(entry: Entry): Entry`; `filterEntries(entries: Entry[], query: string, selectedTags: string[]): Entry[]`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/models/entry.test.ts
import { describe, it, expect } from 'vitest';
import { parseTags, createNote, createEvent, markDeleted, filterEntries } from './entry';

describe('parseTags', () => {
  it('extracts hashtags and lowercases them', () => {
    const result = parseTags('call the dentist #Health #todo');
    expect(result.tags).toEqual(['health', 'todo']);
    expect(result.text).toBe('call the dentist #Health #todo');
  });

  it('deduplicates repeated tags', () => {
    const result = parseTags('#idea great #idea again');
    expect(result.tags).toEqual(['idea']);
  });

  it('returns an empty tag list when there are no hashtags', () => {
    const result = parseTags('just plain text');
    expect(result.tags).toEqual([]);
  });
});

describe('createNote', () => {
  it('creates a note entry with parsed tags', () => {
    const entry = createNote('remember this #idea', 'device-1');
    expect(entry.type).toBe('note');
    expect(entry.tags).toEqual(['idea']);
    expect(entry.deviceId).toBe('device-1');
    expect(entry.deleted).toBe(false);
    expect(entry.id).toBeTruthy();
    expect(entry.createdAt).toBe(entry.modifiedAt);
  });
});

describe('createEvent', () => {
  it('creates an event entry with a date and time', () => {
    const entry = createEvent('dentist #health', '2026-08-01', '15:00', 'device-1');
    expect(entry.type).toBe('event');
    expect(entry.eventDate).toBe('2026-08-01');
    expect(entry.eventTime).toBe('15:00');
    expect(entry.tags).toEqual(['health']);
  });

  it('supports an optional linked note id', () => {
    const entry = createEvent('dentist', '2026-08-01', undefined, 'device-1', 'note-123');
    expect(entry.linkedNoteId).toBe('note-123');
  });
});

describe('markDeleted', () => {
  it('sets deleted and deletedAt without mutating the original', () => {
    const entry = createNote('temporary', 'device-1');
    const tombstoned = markDeleted(entry);
    expect(tombstoned.deleted).toBe(true);
    expect(tombstoned.deletedAt).toBeTypeOf('number');
    expect(entry.deleted).toBe(false);
  });
});

describe('filterEntries', () => {
  const entries = [
    createNote('buy milk #errand', 'device-1'),
    createNote('great podcast #listen', 'device-1'),
    createEvent('dentist appointment #health', '2026-08-01', '15:00', 'device-1'),
  ];

  it('matches by text query case-insensitively', () => {
    const result = filterEntries(entries, 'PODCAST', []);
    expect(result).toHaveLength(1);
    expect(result[0].text).toContain('podcast');
  });

  it('matches by selected tags', () => {
    const result = filterEntries(entries, '', ['health']);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('event');
  });

  it('combines query and tags with AND semantics', () => {
    const result = filterEntries(entries, 'milk', ['errand']);
    expect(result).toHaveLength(1);
  });

  it('returns everything when query and tags are empty', () => {
    expect(filterEntries(entries, '', [])).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- entry`
Expected: FAIL — `src/models/entry.ts` does not exist yet.

- [ ] **Step 3: Write `src/models/entry.ts`**

```ts
export type EntryType = 'note' | 'event';

export interface Entry {
  id: string;
  type: EntryType;
  text: string;
  tags: string[];
  eventDate?: string;
  eventTime?: string;
  linkedNoteId?: string;
  createdAt: number;
  modifiedAt: number;
  deviceId: string;
  deleted: boolean;
  deletedAt?: number;
}

const TAG_PATTERN = /#([a-zA-Z0-9_]+)/g;

export function parseTags(raw: string): { text: string; tags: string[] } {
  const tags = Array.from(new Set(Array.from(raw.matchAll(TAG_PATTERN), (m) => m[1].toLowerCase())));
  return { text: raw.trim(), tags };
}

export function createNote(rawText: string, deviceId: string): Entry {
  const { text, tags } = parseTags(rawText);
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    type: 'note',
    text,
    tags,
    createdAt: now,
    modifiedAt: now,
    deviceId,
    deleted: false,
  };
}

export function createEvent(
  rawText: string,
  eventDate: string,
  eventTime: string | undefined,
  deviceId: string,
  linkedNoteId?: string
): Entry {
  const { text, tags } = parseTags(rawText);
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    type: 'event',
    text,
    tags,
    eventDate,
    eventTime,
    linkedNoteId,
    createdAt: now,
    modifiedAt: now,
    deviceId,
    deleted: false,
  };
}

export function markDeleted(entry: Entry): Entry {
  return { ...entry, deleted: true, deletedAt: Date.now(), modifiedAt: Date.now() };
}

export function filterEntries(entries: Entry[], query: string, selectedTags: string[]): Entry[] {
  const normalizedQuery = query.trim().toLowerCase();
  return entries.filter((entry) => {
    const matchesQuery = normalizedQuery === '' || entry.text.toLowerCase().includes(normalizedQuery);
    const matchesTags = selectedTags.length === 0 || selectedTags.every((tag) => entry.tags.includes(tag));
    return matchesQuery && matchesTags;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- entry`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add src/models/entry.ts src/models/entry.test.ts
git commit -m "feat: add Entry model, tag parsing, and filtering"
```

---

## Task 4: Storage Layer

**Files:**
- Create: `src/storage/db.ts`
- Create: `src/storage/entryRepository.ts`
- Test: `src/storage/entryRepository.test.ts`

**Interfaces:**
- Consumes: `encrypt`/`decrypt` from `src/crypto/crypto.ts` (Task 2); `Entry`, `markDeleted` from `src/models/entry.ts` (Task 3).
- Produces: `getDb()`, `getMeta(key): Promise<string | undefined>`, `setMeta(key, value): Promise<void>`, `getOrCreateDeviceId(): Promise<string>`, `getLastSyncAt(): Promise<number>`, `setLastSyncAt(timestamp: number): Promise<void>` from `db.ts`; `saveEntry(key: CryptoKey, entry: Entry): Promise<void>`, `getAllEntries(key: CryptoKey): Promise<Entry[]>`, `deleteEntry(key: CryptoKey, entries: Entry[], id: string): Promise<Entry[]>` from `entryRepository.ts`.

- [ ] **Step 1: Write `src/storage/db.ts`**

```ts
import { openDB, DBSchema, IDBPDatabase } from 'idb';

interface JotterpadSchema extends DBSchema {
  entries: {
    key: string;
    value: { id: string; blob: string };
  };
  meta: {
    key: string;
    value: string;
  };
}

let dbPromise: Promise<IDBPDatabase<JotterpadSchema>> | null = null;

export function getDb(): Promise<IDBPDatabase<JotterpadSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<JotterpadSchema>('jotterpad', 1, {
      upgrade(db) {
        db.createObjectStore('entries', { keyPath: 'id' });
        db.createObjectStore('meta');
      },
    });
  }
  return dbPromise;
}

export async function getMeta(key: string): Promise<string | undefined> {
  const db = await getDb();
  return db.get('meta', key);
}

export async function setMeta(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.put('meta', value, key);
}

export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await getMeta('deviceId');
  if (existing) return existing;
  const id = crypto.randomUUID();
  await setMeta('deviceId', id);
  return id;
}

export async function getLastSyncAt(): Promise<number> {
  const raw = await getMeta('lastSyncAt');
  return raw ? Number(raw) : 0;
}

export async function setLastSyncAt(timestamp: number): Promise<void> {
  await setMeta('lastSyncAt', String(timestamp));
}
```

- [ ] **Step 2: Write the failing tests for `entryRepository`**

```ts
// src/storage/entryRepository.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { saveEntry, getAllEntries, deleteEntry } from './entryRepository';
import { createNote } from '../models/entry';
import { deriveKey } from '../crypto/crypto';
import { getDb } from './db';

async function resetDb() {
  const db = await getDb();
  await db.clear('entries');
  await db.clear('meta');
}

describe('entryRepository', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('saves and retrieves an entry, encrypted at rest', async () => {
    const { key } = await deriveKey('1234');
    const entry = createNote('buy milk', 'device-1');
    await saveEntry(key, entry);

    const db = await getDb();
    const raw = await db.get('entries', entry.id);
    expect(raw?.blob).not.toContain('buy milk');

    const all = await getAllEntries(key);
    expect(all).toHaveLength(1);
    expect(all[0].text).toBe('buy milk');
  });

  it('marks an entry as deleted via deleteEntry', async () => {
    const { key } = await deriveKey('1234');
    const entry = createNote('temporary note', 'device-1');
    await saveEntry(key, entry);
    const loaded = await getAllEntries(key);

    const updated = await deleteEntry(key, loaded, entry.id);
    expect(updated.find((e) => e.id === entry.id)?.deleted).toBe(true);

    const persisted = await getAllEntries(key);
    expect(persisted.find((e) => e.id === entry.id)?.deleted).toBe(true);
  });

  it('leaves the entry list unchanged when deleting an unknown id', async () => {
    const { key } = await deriveKey('1234');
    const entry = createNote('stays put', 'device-1');
    await saveEntry(key, entry);
    const loaded = await getAllEntries(key);

    const updated = await deleteEntry(key, loaded, 'does-not-exist');
    expect(updated).toEqual(loaded);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- entryRepository`
Expected: FAIL — `src/storage/entryRepository.ts` does not exist yet.

- [ ] **Step 4: Write `src/storage/entryRepository.ts`**

```ts
import { getDb } from './db';
import { encrypt, decrypt } from '../crypto/crypto';
import { Entry, markDeleted } from '../models/entry';

export async function saveEntry(key: CryptoKey, entry: Entry): Promise<void> {
  const db = await getDb();
  const blob = await encrypt(key, JSON.stringify(entry));
  await db.put('entries', { id: entry.id, blob });
}

export async function getAllEntries(key: CryptoKey): Promise<Entry[]> {
  const db = await getDb();
  const rows = await db.getAll('entries');
  return Promise.all(rows.map(async (row) => JSON.parse(await decrypt(key, row.blob)) as Entry));
}

export async function deleteEntry(key: CryptoKey, entries: Entry[], id: string): Promise<Entry[]> {
  const target = entries.find((e) => e.id === id);
  if (!target) return entries;
  const tombstoned = markDeleted(target);
  await saveEntry(key, tombstoned);
  return entries.map((e) => (e.id === id ? tombstoned : e));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- entryRepository`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add src/storage/db.ts src/storage/entryRepository.ts src/storage/entryRepository.test.ts
git commit -m "feat: add encrypted IndexedDB storage layer"
```

---

## Task 5: PIN Module

**Files:**
- Create: `src/auth/pin.ts`
- Test: `src/auth/pin.test.ts`

**Interfaces:**
- Consumes: `deriveKey`, `encrypt`, `decrypt` from `src/crypto/crypto.ts` (Task 2); `getMeta`, `setMeta` from `src/storage/db.ts` (Task 4).
- Produces: `isPinConfigured(): Promise<boolean>`, `setupPin(pin: string): Promise<CryptoKey>`, `unlockWithPin(pin: string): Promise<CryptoKey | null>`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/auth/pin.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { isPinConfigured, setupPin, unlockWithPin } from './pin';
import { getDb } from '../storage/db';

async function resetDb() {
  const db = await getDb();
  await db.clear('meta');
}

describe('pin', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('reports not configured before setup', async () => {
    expect(await isPinConfigured()).toBe(false);
  });

  it('reports configured after setup', async () => {
    await setupPin('4242');
    expect(await isPinConfigured()).toBe(true);
  });

  it('unlocks with the correct pin', async () => {
    await setupPin('4242');
    const key = await unlockWithPin('4242');
    expect(key).not.toBeNull();
  });

  it('refuses to unlock with the wrong pin', async () => {
    await setupPin('4242');
    const key = await unlockWithPin('0000');
    expect(key).toBeNull();
  });

  it('refuses to unlock before any pin is set up', async () => {
    const key = await unlockWithPin('4242');
    expect(key).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- pin`
Expected: FAIL — `src/auth/pin.ts` does not exist yet.

- [ ] **Step 3: Write `src/auth/pin.ts`**

```ts
import { deriveKey, encrypt, decrypt } from '../crypto/crypto';
import { getMeta, setMeta } from '../storage/db';

const VERIFIER_PLAINTEXT = 'jotterpad-verify';

export async function isPinConfigured(): Promise<boolean> {
  return (await getMeta('salt')) !== undefined;
}

export async function setupPin(pin: string): Promise<CryptoKey> {
  const { key, salt } = await deriveKey(pin);
  const verifier = await encrypt(key, VERIFIER_PLAINTEXT);
  await setMeta('salt', salt);
  await setMeta('verifier', verifier);
  return key;
}

export async function unlockWithPin(pin: string): Promise<CryptoKey | null> {
  const salt = await getMeta('salt');
  const verifier = await getMeta('verifier');
  if (!salt || !verifier) return null;
  const { key } = await deriveKey(pin, salt);
  try {
    const decrypted = await decrypt(key, verifier);
    return decrypted === VERIFIER_PLAINTEXT ? key : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- pin`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/auth/pin.ts src/auth/pin.test.ts
git commit -m "feat: add PIN setup/unlock module"
```

---

## Task 6: LockScreen Component

**Files:**
- Create: `src/components/LockScreen.tsx`
- Test: `src/components/LockScreen.test.tsx`

**Interfaces:**
- Consumes: `setupPin`, `unlockWithPin` from `src/auth/pin.ts` (Task 5).
- Produces: `LockScreen({ mode: 'setup' | 'unlock', onUnlock: (key: CryptoKey) => void })`.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/LockScreen.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { LockScreen } from './LockScreen';
import { setupPin } from '../auth/pin';
import { getDb } from '../storage/db';

async function resetDb() {
  const db = await getDb();
  await db.clear('meta');
}

describe('LockScreen', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('shows the unrecoverability warning in setup mode', () => {
    render(<LockScreen mode="setup" onUnlock={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/unrecoverable/i);
  });

  it('rejects mismatched pins during setup', async () => {
    const user = userEvent.setup();
    render(<LockScreen mode="setup" onUnlock={vi.fn()} />);
    await user.type(screen.getByPlaceholderText('PIN'), '1234');
    await user.type(screen.getByPlaceholderText('Confirm PIN'), '5678');
    await user.click(screen.getByRole('button', { name: 'Set PIN' }));
    expect(screen.getByText(/do not match/i)).toBeInTheDocument();
  });

  it('calls onUnlock with a key after successful setup', async () => {
    const user = userEvent.setup();
    const onUnlock = vi.fn();
    render(<LockScreen mode="setup" onUnlock={onUnlock} />);
    await user.type(screen.getByPlaceholderText('PIN'), '1234');
    await user.type(screen.getByPlaceholderText('Confirm PIN'), '1234');
    await user.click(screen.getByRole('button', { name: 'Set PIN' }));
    expect(onUnlock).toHaveBeenCalledTimes(1);
  });

  it('shows an error for the wrong pin in unlock mode', async () => {
    await setupPin('4242');
    const user = userEvent.setup();
    render(<LockScreen mode="unlock" onUnlock={vi.fn()} />);
    await user.type(screen.getByPlaceholderText('PIN'), '0000');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(screen.getByText(/incorrect pin/i)).toBeInTheDocument();
  });

  it('calls onUnlock for the correct pin in unlock mode', async () => {
    await setupPin('4242');
    const user = userEvent.setup();
    const onUnlock = vi.fn();
    render(<LockScreen mode="unlock" onUnlock={onUnlock} />);
    await user.type(screen.getByPlaceholderText('PIN'), '4242');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(onUnlock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- LockScreen`
Expected: FAIL — `src/components/LockScreen.tsx` does not exist yet.

- [ ] **Step 3: Write `src/components/LockScreen.tsx`**

```tsx
import { useState, FormEvent } from 'react';
import { setupPin, unlockWithPin } from '../auth/pin';

interface LockScreenProps {
  mode: 'setup' | 'unlock';
  onUnlock: (key: CryptoKey) => void;
}

export function LockScreen({ mode, onUnlock }: LockScreenProps) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (mode === 'setup') {
      if (pin.length < 4) {
        setError('PIN must be at least 4 digits.');
        return;
      }
      if (pin !== confirmPin) {
        setError('PINs do not match.');
        return;
      }
      const key = await setupPin(pin);
      onUnlock(key);
    } else {
      const key = await unlockWithPin(pin);
      if (!key) {
        setError('Incorrect PIN.');
        return;
      }
      onUnlock(key);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="lock-screen">
      <h1>Jotterpad</h1>
      {mode === 'setup' && (
        <p role="alert">
          If you lose this PIN, your data is permanently unrecoverable. There is no account and no
          way to reset it.
        </p>
      )}
      <input
        type="password"
        inputMode="numeric"
        placeholder="PIN"
        value={pin}
        onChange={(e) => setPin(e.target.value)}
      />
      {mode === 'setup' && (
        <input
          type="password"
          inputMode="numeric"
          placeholder="Confirm PIN"
          value={confirmPin}
          onChange={(e) => setConfirmPin(e.target.value)}
        />
      )}
      {error && <p>{error}</p>}
      <button type="submit">{mode === 'setup' ? 'Set PIN' : 'Unlock'}</button>
    </form>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- LockScreen`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/LockScreen.tsx src/components/LockScreen.test.tsx
git commit -m "feat: add LockScreen component"
```

---

## Task 7: Merge & Conflict Logic

**Files:**
- Create: `src/sync/merge.ts`
- Test: `src/sync/merge.test.ts`

**Interfaces:**
- Consumes: `Entry` from `src/models/entry.ts` (Task 3).
- Produces: `interface ConflictPair { local: Entry; remote: Entry }`, `interface MergeResult { merged: Entry[]; conflicts: ConflictPair[] }`, `selectChangedSince(entries: Entry[], sinceTimestamp: number): Entry[]`, `mergeEntries(local: Entry[], remote: Entry[], lastSyncAt: number): MergeResult`.

This is the highest-priority module for correctness per the spec's testing section — thorough test coverage here matters more than anywhere else in the app.

- [ ] **Step 1: Write the failing tests**

```ts
// src/sync/merge.test.ts
import { describe, it, expect } from 'vitest';
import { selectChangedSince, mergeEntries } from './merge';
import { Entry } from '../models/entry';

function makeEntry(overrides: Partial<Entry>): Entry {
  return {
    id: 'entry-1',
    type: 'note',
    text: 'original text',
    tags: [],
    createdAt: 1000,
    modifiedAt: 1000,
    deviceId: 'device-a',
    deleted: false,
    ...overrides,
  };
}

describe('selectChangedSince', () => {
  it('returns only entries modified after the given timestamp', () => {
    const older = makeEntry({ id: 'a', modifiedAt: 500 });
    const newer = makeEntry({ id: 'b', modifiedAt: 1500 });
    expect(selectChangedSince([older, newer], 1000)).toEqual([newer]);
  });
});

describe('mergeEntries', () => {
  it('unions in a brand-new remote entry', () => {
    const local: Entry[] = [];
    const remote = [makeEntry({ id: 'remote-1' })];
    const { merged, conflicts } = mergeEntries(local, remote, 0);
    expect(merged).toHaveLength(1);
    expect(conflicts).toHaveLength(0);
  });

  it('keeps the local entry unchanged when content is identical', () => {
    const local = [makeEntry({ id: 'a', modifiedAt: 1000 })];
    const remote = [makeEntry({ id: 'a', modifiedAt: 1000 })];
    const { merged, conflicts } = mergeEntries(local, remote, 0);
    expect(merged).toHaveLength(1);
    expect(conflicts).toHaveLength(0);
  });

  it('takes the remote version when only remote changed since last sync', () => {
    const local = [makeEntry({ id: 'a', modifiedAt: 500, text: 'old' })];
    const remote = [makeEntry({ id: 'a', modifiedAt: 2000, text: 'updated remotely' })];
    const { merged, conflicts } = mergeEntries(local, remote, 1000);
    expect(merged.find((e) => e.id === 'a')?.text).toBe('updated remotely');
    expect(conflicts).toHaveLength(0);
  });

  it('keeps the local version when only local changed since last sync', () => {
    const local = [makeEntry({ id: 'a', modifiedAt: 2000, text: 'updated locally' })];
    const remote = [makeEntry({ id: 'a', modifiedAt: 500, text: 'old' })];
    const { merged, conflicts } = mergeEntries(local, remote, 1000);
    expect(merged.find((e) => e.id === 'a')?.text).toBe('updated locally');
    expect(conflicts).toHaveLength(0);
  });

  it('flags a conflict when both sides changed the same entry differently since last sync', () => {
    const local = [makeEntry({ id: 'a', modifiedAt: 2000, text: 'local edit' })];
    const remote = [makeEntry({ id: 'a', modifiedAt: 2100, text: 'remote edit' })];
    const { conflicts } = mergeEntries(local, remote, 1000);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].local.text).toBe('local edit');
    expect(conflicts[0].remote.text).toBe('remote edit');
  });

  it('propagates a remote deletion when local did not change the entry since last sync', () => {
    const local = [makeEntry({ id: 'a', modifiedAt: 500 })];
    const remote = [makeEntry({ id: 'a', modifiedAt: 2000, deleted: true, deletedAt: 2000 })];
    const { merged, conflicts } = mergeEntries(local, remote, 1000);
    expect(merged.find((e) => e.id === 'a')?.deleted).toBe(true);
    expect(conflicts).toHaveLength(0);
  });

  it('flags a conflict when one side deleted and the other edited the same entry since last sync', () => {
    const local = [makeEntry({ id: 'a', modifiedAt: 2000, text: 'still useful' })];
    const remote = [makeEntry({ id: 'a', modifiedAt: 2100, deleted: true, deletedAt: 2100 })];
    const { conflicts } = mergeEntries(local, remote, 1000);
    expect(conflicts).toHaveLength(1);
  });

  it('does not flag a conflict when both sides deleted the same entry independently', () => {
    const local = [makeEntry({ id: 'a', modifiedAt: 2000, deleted: true, deletedAt: 2000 })];
    const remote = [makeEntry({ id: 'a', modifiedAt: 2100, deleted: true, deletedAt: 2100 })];
    const { merged, conflicts } = mergeEntries(local, remote, 1000);
    expect(conflicts).toHaveLength(0);
    expect(merged.find((e) => e.id === 'a')?.deleted).toBe(true);
  });

  it('treats a lastSyncAt of 0 as a full merge (first-ever sync)', () => {
    const local = [makeEntry({ id: 'a', modifiedAt: 100, text: 'from before pairing' })];
    const remote = [makeEntry({ id: 'a', modifiedAt: 200, text: 'also from before pairing' })];
    const { conflicts } = mergeEntries(local, remote, 0);
    expect(conflicts).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- merge`
Expected: FAIL — `src/sync/merge.ts` does not exist yet.

- [ ] **Step 3: Write `src/sync/merge.ts`**

```ts
import { Entry } from '../models/entry';

export interface ConflictPair {
  local: Entry;
  remote: Entry;
}

export interface MergeResult {
  merged: Entry[];
  conflicts: ConflictPair[];
}

export function selectChangedSince(entries: Entry[], sinceTimestamp: number): Entry[] {
  return entries.filter((e) => e.modifiedAt > sinceTimestamp);
}

function contentEquals(a: Entry, b: Entry): boolean {
  return (
    a.type === b.type &&
    a.text === b.text &&
    a.deleted === b.deleted &&
    a.eventDate === b.eventDate &&
    a.eventTime === b.eventTime &&
    a.linkedNoteId === b.linkedNoteId &&
    JSON.stringify([...a.tags].sort()) === JSON.stringify([...b.tags].sort())
  );
}

export function mergeEntries(local: Entry[], remote: Entry[], lastSyncAt: number): MergeResult {
  const merged = new Map<string, Entry>(local.map((e) => [e.id, e]));
  const conflicts: ConflictPair[] = [];

  for (const remoteEntry of remote) {
    const localEntry = merged.get(remoteEntry.id);

    if (!localEntry) {
      merged.set(remoteEntry.id, remoteEntry);
      continue;
    }

    if (contentEquals(localEntry, remoteEntry)) {
      merged.set(remoteEntry.id, remoteEntry.modifiedAt >= localEntry.modifiedAt ? remoteEntry : localEntry);
      continue;
    }

    const localChangedSinceSync = localEntry.modifiedAt > lastSyncAt;
    const remoteChangedSinceSync = remoteEntry.modifiedAt > lastSyncAt;

    if (localChangedSinceSync && remoteChangedSinceSync) {
      conflicts.push({ local: localEntry, remote: remoteEntry });
      continue;
    }

    if (remoteChangedSinceSync && !localChangedSinceSync) {
      merged.set(remoteEntry.id, remoteEntry);
    }
  }

  return { merged: Array.from(merged.values()), conflicts };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- merge`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add src/sync/merge.ts src/sync/merge.test.ts
git commit -m "feat: add merge and conflict-detection logic"
```

---

## Task 8: QR Chunking Protocol

**Files:**
- Create: `src/sync/qrProtocol.ts`
- Test: `src/sync/qrProtocol.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface QrFrame { seq: number; total: number; sessionId: string; payload: string }`, `chunkPayload(data: unknown, sessionId: string): string[]`, `parseFrame(raw: string): QrFrame`, `class FrameReassembler { addFrame(frame: QrFrame): void; isComplete(): boolean; getResult<T>(): T }`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/sync/qrProtocol.test.ts
import { describe, it, expect } from 'vitest';
import { chunkPayload, parseFrame, FrameReassembler } from './qrProtocol';

describe('chunkPayload and parseFrame', () => {
  it('produces a single frame for a small payload', () => {
    const frames = chunkPayload({ hello: 'world' }, 'session-1');
    expect(frames).toHaveLength(1);
    const parsed = parseFrame(frames[0]);
    expect(parsed.total).toBe(1);
    expect(parsed.sessionId).toBe('session-1');
  });

  it('splits a large payload into multiple frames', () => {
    const bigArray = Array.from({ length: 500 }, (_, i) => ({ id: i, text: 'x'.repeat(50) }));
    const frames = chunkPayload(bigArray, 'session-2');
    expect(frames.length).toBeGreaterThan(1);
    frames.forEach((raw, index) => {
      const parsed = parseFrame(raw);
      expect(parsed.seq).toBe(index);
      expect(parsed.total).toBe(frames.length);
    });
  });

  it('throws on a malformed frame', () => {
    expect(() => parseFrame('not json')).toThrow();
    expect(() => parseFrame(JSON.stringify({ seq: 0 }))).toThrow();
  });
});

describe('FrameReassembler', () => {
  it('reassembles a single-frame payload', () => {
    const frames = chunkPayload({ a: 1 }, 'session-1');
    const reassembler = new FrameReassembler();
    reassembler.addFrame(parseFrame(frames[0]));
    expect(reassembler.isComplete()).toBe(true);
    expect(reassembler.getResult()).toEqual({ a: 1 });
  });

  it('reassembles a multi-frame payload regardless of arrival order', () => {
    const bigArray = Array.from({ length: 500 }, (_, i) => ({ id: i, text: 'x'.repeat(50) }));
    const frames = chunkPayload(bigArray, 'session-3').map(parseFrame);
    const reassembler = new FrameReassembler();
    for (const frame of [...frames].reverse()) {
      reassembler.addFrame(frame);
    }
    expect(reassembler.isComplete()).toBe(true);
    expect(reassembler.getResult()).toEqual(bigArray);
  });

  it('is not complete until all frames have arrived', () => {
    const bigArray = Array.from({ length: 500 }, (_, i) => ({ id: i, text: 'x'.repeat(50) }));
    const frames = chunkPayload(bigArray, 'session-4').map(parseFrame);
    const reassembler = new FrameReassembler();
    reassembler.addFrame(frames[0]);
    expect(reassembler.isComplete()).toBe(false);
  });

  it('resets when a frame from a new session arrives', () => {
    const framesA = chunkPayload({ a: 1 }, 'session-a').map(parseFrame);
    const framesB = chunkPayload({ b: 2 }, 'session-b').map(parseFrame);
    const reassembler = new FrameReassembler();
    reassembler.addFrame(framesA[0]);
    reassembler.addFrame(framesB[0]);
    expect(reassembler.isComplete()).toBe(true);
    expect(reassembler.getResult()).toEqual({ b: 2 });
  });

  it('throws if getResult is called before completion', () => {
    const reassembler = new FrameReassembler();
    expect(() => reassembler.getResult()).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- qrProtocol`
Expected: FAIL — `src/sync/qrProtocol.ts` does not exist yet.

- [ ] **Step 3: Write `src/sync/qrProtocol.ts`**

```ts
export interface QrFrame {
  seq: number;
  total: number;
  sessionId: string;
  payload: string;
}

const MAX_FRAME_CHARS = 900;

export function chunkPayload(data: unknown, sessionId: string): string[] {
  const json = JSON.stringify(data);
  const chunks: string[] = [];
  for (let i = 0; i < json.length; i += MAX_FRAME_CHARS) {
    chunks.push(json.slice(i, i + MAX_FRAME_CHARS));
  }
  if (chunks.length === 0) chunks.push('');
  const total = chunks.length;
  return chunks.map((payload, index) => JSON.stringify({ seq: index, total, sessionId, payload }));
}

export function parseFrame(raw: string): QrFrame {
  const frame = JSON.parse(raw) as Partial<QrFrame>;
  if (
    typeof frame.seq !== 'number' ||
    typeof frame.total !== 'number' ||
    typeof frame.sessionId !== 'string' ||
    typeof frame.payload !== 'string'
  ) {
    throw new Error('Invalid QR frame');
  }
  return frame as QrFrame;
}

export class FrameReassembler {
  private sessionId: string | null = null;
  private total = 0;
  private chunks = new Map<number, string>();

  addFrame(frame: QrFrame): void {
    if (this.sessionId === null || frame.sessionId !== this.sessionId) {
      this.sessionId = frame.sessionId;
      this.total = frame.total;
      this.chunks.clear();
    }
    this.chunks.set(frame.seq, frame.payload);
  }

  isComplete(): boolean {
    return this.sessionId !== null && this.chunks.size === this.total;
  }

  getResult<T>(): T {
    if (!this.isComplete()) throw new Error('Reassembly incomplete');
    let json = '';
    for (let i = 0; i < this.total; i++) {
      json += this.chunks.get(i) ?? '';
    }
    return JSON.parse(json) as T;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- qrProtocol`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/sync/qrProtocol.ts src/sync/qrProtocol.test.ts
git commit -m "feat: add QR frame chunking and reassembly protocol"
```

---

## Task 9: Timeline, CaptureBar, EntryItem

**Files:**
- Create: `src/components/CaptureBar.tsx`
- Create: `src/components/EntryItem.tsx`
- Create: `src/components/Timeline.tsx`
- Test: `src/components/Timeline.test.tsx`

**Interfaces:**
- Consumes: `Entry` from `src/models/entry.ts` (Task 3).
- Produces: `CaptureBar({ onAddNote: (rawText: string) => void; onAddEvent: (rawText: string, eventDate: string, eventTime: string) => void })`; `EntryItem({ entry: Entry; onDelete: (id: string) => void })`; `Timeline({ entries: Entry[]; onAddNote; onAddEvent; onDelete })`. Timeline is presentational only — it does not know about storage or crypto; the caller (Task 14's `App`) owns loading/persisting entries and passes callbacks down.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/Timeline.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Timeline } from './Timeline';
import { createNote, createEvent } from '../models/entry';

describe('Timeline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-23T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders past notes and events in chronological order', () => {
    const note = createNote('first thought', 'device-1');
    const event = createEvent('past appointment', '2026-07-20', '09:00', 'device-1');
    render(
      <Timeline entries={[event, note]} onAddNote={vi.fn()} onAddEvent={vi.fn()} onDelete={vi.fn()} />
    );
    expect(screen.getByText('first thought')).toBeInTheDocument();
    expect(screen.getByText('past appointment')).toBeInTheDocument();
  });

  it('renders future events below past entries', () => {
    const upcoming = createEvent('future appointment', '2026-08-01', '09:00', 'device-1');
    render(
      <Timeline entries={[upcoming]} onAddNote={vi.fn()} onAddEvent={vi.fn()} onDelete={vi.fn()} />
    );
    expect(screen.getByText('future appointment')).toBeInTheDocument();
  });

  it('adds a note through the capture bar in note mode', async () => {
    const user = userEvent.setup({ delay: null });
    const onAddNote = vi.fn();
    render(<Timeline entries={[]} onAddNote={onAddNote} onAddEvent={vi.fn()} onDelete={vi.fn()} />);
    await user.type(screen.getByPlaceholderText('Jot a thought...'), 'a new idea');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(onAddNote).toHaveBeenCalledWith('a new idea');
  });

  it('adds an event through the capture bar after toggling to event mode', async () => {
    const user = userEvent.setup({ delay: null });
    const onAddEvent = vi.fn();
    const { container } = render(
      <Timeline entries={[]} onAddNote={vi.fn()} onAddEvent={onAddEvent} onDelete={vi.fn()} />
    );
    await user.click(screen.getByRole('button', { name: 'Note' }));
    await user.type(screen.getByPlaceholderText('Jot a thought...'), 'dentist');
    const dateInput = container.querySelector('input[type="date"]');
    if (!dateInput) throw new Error('date input not found');
    fireDateInput(dateInput, '2026-08-01');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(onAddEvent).toHaveBeenCalledWith('dentist', '2026-08-01', '');
  });

  it('calls onDelete when an entry is deleted', async () => {
    const user = userEvent.setup({ delay: null });
    const onDelete = vi.fn();
    const note = createNote('delete me', 'device-1');
    render(<Timeline entries={[note]} onAddNote={vi.fn()} onAddEvent={vi.fn()} onDelete={onDelete} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith(note.id);
  });
});

function fireDateInput(input: HTMLElement, value: string) {
  (input as HTMLInputElement).value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- Timeline`
Expected: FAIL — the components don't exist yet.

- [ ] **Step 3: Write `src/components/EntryItem.tsx`**

```tsx
import { Entry } from '../models/entry';

interface EntryItemProps {
  entry: Entry;
  onDelete: (id: string) => void;
}

export function EntryItem({ entry, onDelete }: EntryItemProps) {
  return (
    <div className="entry" data-type={entry.type}>
      <span>{entry.type === 'event' ? '📅' : '📝'}</span>
      <span>{entry.text}</span>
      {entry.type === 'event' && (
        <span>
          {entry.eventDate} {entry.eventTime}
        </span>
      )}
      {entry.tags.map((tag) => (
        <span key={tag} className="tag">
          #{tag}
        </span>
      ))}
      <button onClick={() => onDelete(entry.id)}>Delete</button>
    </div>
  );
}
```

- [ ] **Step 4: Write `src/components/CaptureBar.tsx`**

```tsx
import { useState, FormEvent } from 'react';

interface CaptureBarProps {
  onAddNote: (rawText: string) => void;
  onAddEvent: (rawText: string, eventDate: string, eventTime: string) => void;
}

export function CaptureBar({ onAddNote, onAddEvent }: CaptureBarProps) {
  const [mode, setMode] = useState<'note' | 'event'>('note');
  const [text, setText] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    if (mode === 'note') {
      onAddNote(text);
    } else {
      if (!date) return;
      onAddEvent(text, date, time);
    }
    setText('');
    setDate('');
    setTime('');
  }

  return (
    <form onSubmit={handleSubmit} className="capture-bar">
      <button type="button" onClick={() => setMode(mode === 'note' ? 'event' : 'note')}>
        {mode === 'note' ? 'Note' : 'Event'}
      </button>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Jot a thought..." />
      {mode === 'event' && (
        <>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </>
      )}
      <button type="submit">Add</button>
    </form>
  );
}
```

- [ ] **Step 5: Write `src/components/Timeline.tsx`**

```tsx
import { Entry } from '../models/entry';
import { CaptureBar } from './CaptureBar';
import { EntryItem } from './EntryItem';

interface TimelineProps {
  entries: Entry[];
  onAddNote: (rawText: string) => void;
  onAddEvent: (rawText: string, eventDate: string, eventTime: string) => void;
  onDelete: (id: string) => void;
}

function eventTimestamp(entry: Entry): number {
  return new Date(`${entry.eventDate}T${entry.eventTime || '00:00'}`).getTime();
}

export function Timeline({ entries, onAddNote, onAddEvent, onDelete }: TimelineProps) {
  const now = Date.now();

  const past = entries
    .filter((e) => e.type === 'note' || (e.eventDate && eventTimestamp(e) <= now))
    .sort((a, b) => a.createdAt - b.createdAt);

  const upcoming = entries
    .filter((e) => e.type === 'event' && e.eventDate && eventTimestamp(e) > now)
    .sort((a, b) => eventTimestamp(a) - eventTimestamp(b));

  return (
    <div className="timeline">
      <div className="feed">
        {past.map((entry) => (
          <EntryItem key={entry.id} entry={entry} onDelete={onDelete} />
        ))}
        {upcoming.map((entry) => (
          <EntryItem key={entry.id} entry={entry} onDelete={onDelete} />
        ))}
      </div>
      <CaptureBar onAddNote={onAddNote} onAddEvent={onAddEvent} />
    </div>
  );
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- Timeline`
Expected: PASS (5 tests)

- [ ] **Step 7: Commit**

```bash
git add src/components/CaptureBar.tsx src/components/EntryItem.tsx src/components/Timeline.tsx src/components/Timeline.test.tsx
git commit -m "feat: add Timeline, CaptureBar, and EntryItem components"
```

---

## Task 10: Tag Filter Bar and Search Bar

**Files:**
- Create: `src/components/TagFilterBar.tsx`
- Create: `src/components/SearchBar.tsx`
- Test: `src/components/TagFilterBar.test.tsx`
- Test: `src/components/SearchBar.test.tsx`

**Interfaces:**
- Consumes: nothing beyond React.
- Produces: `TagFilterBar({ tags: string[]; selected: string[]; onToggle: (tag: string) => void })`; `SearchBar({ value: string; onChange: (value: string) => void })`. (`filterEntries` already exists from Task 3 and is what these get wired to in Task 14.)

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/TagFilterBar.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { TagFilterBar } from './TagFilterBar';

describe('TagFilterBar', () => {
  it('renders one button per tag', () => {
    render(<TagFilterBar tags={['idea', 'health']} selected={[]} onToggle={vi.fn()} />);
    expect(screen.getByRole('button', { name: '#idea' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '#health' })).toBeInTheDocument();
  });

  it('marks selected tags as active', () => {
    render(<TagFilterBar tags={['idea']} selected={['idea']} onToggle={vi.fn()} />);
    expect(screen.getByRole('button', { name: '#idea' })).toHaveClass('active');
  });

  it('calls onToggle with the clicked tag', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<TagFilterBar tags={['idea']} selected={[]} onToggle={onToggle} />);
    await user.click(screen.getByRole('button', { name: '#idea' }));
    expect(onToggle).toHaveBeenCalledWith('idea');
  });
});
```

```tsx
// src/components/SearchBar.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { SearchBar } from './SearchBar';

describe('SearchBar', () => {
  it('calls onChange as the user types', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SearchBar value="" onChange={onChange} />);
    await user.type(screen.getByPlaceholderText('Search notes and events...'), 'milk');
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it('displays the current value', () => {
    render(<SearchBar value="milk" onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('milk')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- TagFilterBar SearchBar`
Expected: FAIL — the components don't exist yet.

- [ ] **Step 3: Write `src/components/TagFilterBar.tsx`**

```tsx
interface TagFilterBarProps {
  tags: string[];
  selected: string[];
  onToggle: (tag: string) => void;
}

export function TagFilterBar({ tags, selected, onToggle }: TagFilterBarProps) {
  return (
    <div className="tag-filter-bar">
      {tags.map((tag) => (
        <button
          key={tag}
          className={selected.includes(tag) ? 'tag active' : 'tag'}
          onClick={() => onToggle(tag)}
        >
          #{tag}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Write `src/components/SearchBar.tsx`**

```tsx
interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

export function SearchBar({ value, onChange }: SearchBarProps) {
  return (
    <input
      className="search-bar"
      type="search"
      placeholder="Search notes and events..."
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- TagFilterBar SearchBar`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add src/components/TagFilterBar.tsx src/components/SearchBar.tsx src/components/TagFilterBar.test.tsx src/components/SearchBar.test.tsx
git commit -m "feat: add tag filter bar and search bar components"
```

---

## Task 11: QR Sync — Actions, Display, Scanner, Conflict Resolver

**Files:**
- Create: `src/sync/syncActions.ts`
- Test: `src/sync/syncActions.test.ts`
- Create: `src/components/QrDisplay.tsx`
- Create: `src/components/QrScanner.tsx`
- Create: `src/components/SyncScreen.tsx`
- Create: `src/components/ConflictResolver.tsx`
- Test: `src/components/ConflictResolver.test.tsx`
- Create: `src/types/jsqr.d.ts`

**Interfaces:**
- Consumes: `selectChangedSince`, `mergeEntries`, `ConflictPair` from `src/sync/merge.ts` (Task 7); `chunkPayload`, `parseFrame`, `FrameReassembler` from `src/sync/qrProtocol.ts` (Task 8); `saveEntry` from `src/storage/entryRepository.ts` (Task 4); `getLastSyncAt`, `setLastSyncAt` from `src/storage/db.ts` (Task 4); `Entry` from `src/models/entry.ts` (Task 3).
- Produces: `interface SyncBundle { senderDeviceId: string; entries: Entry[] }`; `prepareOutgoingBundle(deviceId: string, entries: Entry[]): Promise<string[]>`; `applyScannedBundle(cryptoKey: CryptoKey, localEntries: Entry[], bundle: SyncBundle): Promise<{ merged: Entry[]; conflicts: ConflictPair[] }>`; `QrDisplay({ frames: string[]; onDone: () => void })`; `QrScanner({ onComplete: (data: unknown) => void })`; `SyncScreen({ entries, deviceId, cryptoKey, onMerged, onClose })`; `ConflictResolver({ conflicts: ConflictPair[]; onResolve: (entry: Entry) => void })`.

The camera-driven pieces (`QrDisplay`, `QrScanner`, the end-to-end `SyncScreen` flow) are verified manually across two real devices per the spec's testing approach — they can't meaningfully run under jsdom. `syncActions.ts` carries all the actual sync logic and gets full automated coverage; `ConflictResolver` is plain React and gets automated coverage too.

- [ ] **Step 1: Write the failing tests for `syncActions`**

```ts
// src/sync/syncActions.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { prepareOutgoingBundle, applyScannedBundle, SyncBundle } from './syncActions';
import { parseFrame, FrameReassembler } from './qrProtocol';
import { createNote } from '../models/entry';
import { deriveKey } from '../crypto/crypto';
import { getDb, setLastSyncAt } from '../storage/db';
import { getAllEntries } from '../storage/entryRepository';

async function resetDb() {
  const db = await getDb();
  await db.clear('entries');
  await db.clear('meta');
}

describe('syncActions', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('prepareOutgoingBundle only includes entries changed since the last sync', async () => {
    await setLastSyncAt(1000);
    const oldEntry = createNote('old', 'device-a');
    oldEntry.modifiedAt = 500;
    const newEntry = createNote('new', 'device-a');
    newEntry.modifiedAt = 2000;

    const frames = await prepareOutgoingBundle('device-a', [oldEntry, newEntry]);
    const reassembler = new FrameReassembler();
    frames.forEach((f) => reassembler.addFrame(parseFrame(f)));
    const bundle = reassembler.getResult<SyncBundle>();

    expect(bundle.senderDeviceId).toBe('device-a');
    expect(bundle.entries).toHaveLength(1);
    expect(bundle.entries[0].text).toBe('new');
  });

  it('applyScannedBundle merges remote entries and persists them', async () => {
    const { key } = await deriveKey('1234');
    const remoteEntry = createNote('from the other device', 'device-b');
    const bundle: SyncBundle = { senderDeviceId: 'device-b', entries: [remoteEntry] };

    const { merged, conflicts } = await applyScannedBundle(key, [], bundle);
    expect(merged).toHaveLength(1);
    expect(conflicts).toHaveLength(0);

    const persisted = await getAllEntries(key);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].text).toBe('from the other device');
  });

  it('applyScannedBundle advances lastSyncAt', async () => {
    const { key } = await deriveKey('1234');
    const bundle: SyncBundle = { senderDeviceId: 'device-b', entries: [] };
    const before = Date.now();
    await applyScannedBundle(key, [], bundle);
    const { getLastSyncAt } = await import('../storage/db');
    expect(await getLastSyncAt()).toBeGreaterThanOrEqual(before);
  });

  it('applyScannedBundle surfaces conflicts without silently overwriting local changes', async () => {
    const { key } = await deriveKey('1234');
    await setLastSyncAt(1000);
    const localEntry = createNote('local edit', 'device-a');
    localEntry.id = 'shared-id';
    localEntry.modifiedAt = 2000;
    const remoteEntry = createNote('remote edit', 'device-b');
    remoteEntry.id = 'shared-id';
    remoteEntry.modifiedAt = 2100;

    const bundle: SyncBundle = { senderDeviceId: 'device-b', entries: [remoteEntry] };
    const { conflicts } = await applyScannedBundle(key, [localEntry], bundle);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].local.text).toBe('local edit');
    expect(conflicts[0].remote.text).toBe('remote edit');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- syncActions`
Expected: FAIL — `src/sync/syncActions.ts` does not exist yet.

- [ ] **Step 3: Write `src/sync/syncActions.ts`**

```ts
import { Entry } from '../models/entry';
import { mergeEntries, ConflictPair, selectChangedSince } from './merge';
import { chunkPayload } from './qrProtocol';
import { saveEntry } from '../storage/entryRepository';
import { getLastSyncAt, setLastSyncAt } from '../storage/db';

export interface SyncBundle {
  senderDeviceId: string;
  entries: Entry[];
}

export async function prepareOutgoingBundle(deviceId: string, entries: Entry[]): Promise<string[]> {
  const lastSyncAt = await getLastSyncAt();
  const changed = selectChangedSince(entries, lastSyncAt);
  const bundle: SyncBundle = { senderDeviceId: deviceId, entries: changed };
  return chunkPayload(bundle, crypto.randomUUID());
}

export async function applyScannedBundle(
  cryptoKey: CryptoKey,
  localEntries: Entry[],
  bundle: SyncBundle
): Promise<{ merged: Entry[]; conflicts: ConflictPair[] }> {
  const lastSyncAt = await getLastSyncAt();
  const { merged, conflicts } = mergeEntries(localEntries, bundle.entries, lastSyncAt);
  for (const entry of merged) {
    await saveEntry(cryptoKey, entry);
  }
  await setLastSyncAt(Date.now());
  return { merged, conflicts };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- syncActions`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the failing tests for `ConflictResolver`**

```tsx
// src/components/ConflictResolver.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ConflictResolver } from './ConflictResolver';
import { createNote } from '../models/entry';

describe('ConflictResolver', () => {
  it('renders nothing when there are no conflicts', () => {
    const { container } = render(<ConflictResolver conflicts={[]} onResolve={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows both versions of the first conflict', () => {
    const local = createNote('local version', 'device-a');
    const remote = createNote('remote version', 'device-b');
    render(<ConflictResolver conflicts={[{ local, remote }]} onResolve={vi.fn()} />);
    expect(screen.getByText(/local version/)).toBeInTheDocument();
    expect(screen.getByText(/remote version/)).toBeInTheDocument();
  });

  it('calls onResolve with the chosen version', async () => {
    const user = userEvent.setup();
    const local = createNote('local version', 'device-a');
    const remote = createNote('remote version', 'device-b');
    const onResolve = vi.fn();
    render(<ConflictResolver conflicts={[{ local, remote }]} onResolve={onResolve} />);
    await user.click(screen.getByText(/local version/));
    expect(onResolve).toHaveBeenCalledWith(local);
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npm test -- ConflictResolver`
Expected: FAIL — `src/components/ConflictResolver.tsx` does not exist yet.

- [ ] **Step 7: Write `src/components/ConflictResolver.tsx`**

```tsx
import { ConflictPair } from '../sync/merge';
import { Entry } from '../models/entry';

interface ConflictResolverProps {
  conflicts: ConflictPair[];
  onResolve: (entry: Entry) => void;
}

export function ConflictResolver({ conflicts, onResolve }: ConflictResolverProps) {
  if (conflicts.length === 0) return null;
  const current = conflicts[0];
  return (
    <div className="conflict-resolver">
      <h2>Conflicting changes</h2>
      <p>This entry was edited on both devices since the last sync. Pick one:</p>
      <button onClick={() => onResolve(current.local)}>This device's version: {current.local.text}</button>
      <button onClick={() => onResolve(current.remote)}>Other device's version: {current.remote.text}</button>
    </div>
  );
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test -- ConflictResolver`
Expected: PASS (3 tests)

- [ ] **Step 9: Write `src/types/jsqr.d.ts`**

```ts
declare module 'jsqr' {
  interface QRCode {
    data: string;
  }
  export default function jsQR(
    data: Uint8ClampedArray,
    width: number,
    height: number
  ): QRCode | null;
}
```

- [ ] **Step 10: Install `jsqr` and write `src/components/QrDisplay.tsx`**

Run: `npm install jsqr`

```tsx
import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

interface QrDisplayProps {
  frames: string[];
  onDone: () => void;
}

export function QrDisplay({ frames, onDone }: QrDisplayProps) {
  const [index, setIndex] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => (i + 1) % frames.length), 800);
    return () => clearInterval(timer);
  }, [frames.length]);

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, frames[index]);
    }
  }, [index, frames]);

  return (
    <div className="qr-display">
      <canvas ref={canvasRef} />
      <p>
        Frame {index + 1} of {frames.length}
      </p>
      <button onClick={onDone}>Done showing</button>
    </div>
  );
}
```

- [ ] **Step 11: Write `src/components/QrScanner.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { FrameReassembler, parseFrame } from '../sync/qrProtocol';

interface QrScannerProps {
  onComplete: (data: unknown) => void;
}

export function QrScanner({ onComplete }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [framesReceived, setFramesReceived] = useState(0);
  const [totalFrames, setTotalFrames] = useState<number | null>(null);

  useEffect(() => {
    const reassembler = new FrameReassembler();
    let stream: MediaStream | undefined;
    let cancelled = false;

    async function start() {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play();
      }
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      function tick() {
        if (cancelled) return;
        if (video && video.readyState === video.HAVE_ENOUGH_DATA && ctx) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height);
          if (code) {
            try {
              const frame = parseFrame(code.data);
              reassembler.addFrame(frame);
              setTotalFrames(frame.total);
              setFramesReceived((n) => n + 1);
              if (reassembler.isComplete()) {
                cancelled = true;
                stream?.getTracks().forEach((t) => t.stop());
                onComplete(reassembler.getResult());
                return;
              }
            } catch {
              /* not a valid frame this tick, keep scanning */
            }
          }
        }
        requestAnimationFrame(tick);
      }
      tick();
    }

    start();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onComplete]);

  return (
    <div className="qr-scanner">
      <video ref={videoRef} muted playsInline />
      <p>{totalFrames ? `Received ${framesReceived} of ${totalFrames} frames` : 'Point camera at QR code...'}</p>
    </div>
  );
}
```

- [ ] **Step 12: Write `src/components/SyncScreen.tsx`**

```tsx
import { useState } from 'react';
import { Entry } from '../models/entry';
import { ConflictPair } from '../sync/merge';
import { prepareOutgoingBundle, applyScannedBundle, SyncBundle } from '../sync/syncActions';
import { QrDisplay } from './QrDisplay';
import { QrScanner } from './QrScanner';

interface SyncScreenProps {
  entries: Entry[];
  deviceId: string;
  cryptoKey: CryptoKey;
  onMerged: (merged: Entry[], conflicts: ConflictPair[]) => void;
  onClose: () => void;
}

type SyncStep = 'menu' | 'showing' | 'scanning';

export function SyncScreen({ entries, deviceId, cryptoKey, onMerged, onClose }: SyncScreenProps) {
  const [step, setStep] = useState<SyncStep>('menu');
  const [frames, setFrames] = useState<string[]>([]);

  async function startShowing() {
    setFrames(await prepareOutgoingBundle(deviceId, entries));
    setStep('showing');
  }

  async function handleScanned(data: unknown) {
    const { merged, conflicts } = await applyScannedBundle(cryptoKey, entries, data as SyncBundle);
    onMerged(merged, conflicts);
    setStep('menu');
  }

  if (step === 'showing') {
    return <QrDisplay frames={frames} onDone={() => setStep('menu')} />;
  }
  if (step === 'scanning') {
    return <QrScanner onComplete={handleScanned} />;
  }
  return (
    <div className="sync-screen">
      <button onClick={startShowing}>Show My Changes</button>
      <button onClick={() => setStep('scanning')}>Scan Partner's Changes</button>
      <button onClick={onClose}>Close</button>
    </div>
  );
}
```

- [ ] **Step 13: Commit**

```bash
git add src/sync/syncActions.ts src/sync/syncActions.test.ts src/components/QrDisplay.tsx src/components/QrScanner.tsx src/components/SyncScreen.tsx src/components/ConflictResolver.tsx src/components/ConflictResolver.test.tsx src/types/jsqr.d.ts package.json package-lock.json
git commit -m "feat: add QR-based sync actions, display, scanner, and conflict resolver"
```

- [ ] **Step 14: Manual verification (two real devices)**

With the dev server running and accessible from a second device on the same network (or two browser windows using a laptop's webcam/phone camera pointed at a monitor):
1. Set up a PIN on Device A, add two notes and one future event.
2. Set up a PIN on Device B (independently).
3. On Device A, open Sync → "Show My Changes"; on Device B, open Sync → "Scan Partner's Changes". Confirm B's Timeline now shows A's entries.
4. Reverse roles so A scans B's (empty, on a first run) changes.
5. Edit the same note's text independently on both devices, then repeat the two-pass sync — confirm the `ConflictResolver` appears and picking a version updates the Timeline.

---

## Task 12: Export/Import Backup

**Files:**
- Create: `src/backup/backup.ts`
- Test: `src/backup/backup.test.ts`
- Create: `src/components/ExportSettings.tsx`
- Create: `src/components/ImportBackup.tsx`
- Test: `src/components/ExportSettings.test.tsx`
- Test: `src/components/ImportBackup.test.tsx`

**Interfaces:**
- Consumes: `deriveKey`, `encrypt`, `decrypt` from `src/crypto/crypto.ts` (Task 2); `unlockWithPin` from `src/auth/pin.ts` (Task 5); `Entry` from `src/models/entry.ts` (Task 3); `mergeEntries`, `ConflictPair` from `src/sync/merge.ts` (Task 7); `saveEntry` from `src/storage/entryRepository.ts` (Task 4).
- Produces: `interface BackupFile { version: 1; salt: string; ciphertext: string }`; `createBackup(secret: string, entries: Entry[]): Promise<BackupFile>`; `restoreBackup(secret: string, file: BackupFile): Promise<Entry[]>`; `ExportSettings({ entries: Entry[] })`; `ImportBackup({ cryptoKey: CryptoKey; localEntries: Entry[]; onImported: (merged: Entry[], conflicts: ConflictPair[]) => void })`.

- [ ] **Step 1: Write the failing tests for `backup.ts`**

```ts
// src/backup/backup.test.ts
import { describe, it, expect } from 'vitest';
import { createBackup, restoreBackup } from './backup';
import { createNote } from '../models/entry';

describe('backup', () => {
  it('round-trips entries through createBackup/restoreBackup', async () => {
    const entries = [createNote('backed up thought', 'device-1')];
    const file = await createBackup('a strong passphrase', entries);
    const restored = await restoreBackup('a strong passphrase', file);
    expect(restored).toHaveLength(1);
    expect(restored[0].text).toBe('backed up thought');
  });

  it('fails to restore with the wrong secret', async () => {
    const entries = [createNote('secret thought', 'device-1')];
    const file = await createBackup('correct secret', entries);
    await expect(restoreBackup('wrong secret', file)).rejects.toThrow();
  });

  it('stores ciphertext, not plaintext, in the backup file', async () => {
    const entries = [createNote('do not leak this', 'device-1')];
    const file = await createBackup('a passphrase', entries);
    expect(file.ciphertext).not.toContain('do not leak this');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- backup`
Expected: FAIL — `src/backup/backup.ts` does not exist yet.

- [ ] **Step 3: Write `src/backup/backup.ts`**

```ts
import { deriveKey, encrypt, decrypt } from '../crypto/crypto';
import { Entry } from '../models/entry';

export interface BackupFile {
  version: 1;
  salt: string;
  ciphertext: string;
}

export async function createBackup(secret: string, entries: Entry[]): Promise<BackupFile> {
  const { key, salt } = await deriveKey(secret);
  const ciphertext = await encrypt(key, JSON.stringify(entries));
  return { version: 1, salt, ciphertext };
}

export async function restoreBackup(secret: string, file: BackupFile): Promise<Entry[]> {
  const { key } = await deriveKey(secret, file.salt);
  const json = await decrypt(key, file.ciphertext);
  return JSON.parse(json) as Entry[];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- backup`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the failing tests for `ExportSettings`**

```tsx
// src/components/ExportSettings.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { ExportSettings } from './ExportSettings';
import { setupPin } from '../auth/pin';
import { getDb } from '../storage/db';
import { createNote } from '../models/entry';

async function resetDb() {
  const db = await getDb();
  await db.clear('meta');
}

describe('ExportSettings', () => {
  beforeEach(async () => {
    await resetDb();
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
  });

  it('shows the unrecoverability warning', () => {
    render(<ExportSettings entries={[]} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/unrecoverable/i);
  });

  it('rejects mismatched passphrases when the passphrase option is chosen', async () => {
    const user = userEvent.setup();
    render(<ExportSettings entries={[createNote('x', 'device-1')]} />);
    await user.click(screen.getByLabelText('Set a passphrase for this file'));
    await user.type(screen.getByPlaceholderText('Enter passphrase'), 'abcd1234');
    await user.type(screen.getByPlaceholderText('Confirm passphrase'), 'different');
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(screen.getByText(/do not match/i)).toBeInTheDocument();
  });

  it('rejects an incorrect device PIN when the PIN option is chosen', async () => {
    await setupPin('4242');
    const user = userEvent.setup();
    render(<ExportSettings entries={[createNote('x', 'device-1')]} />);
    await user.type(screen.getByPlaceholderText('Enter device PIN'), '0000');
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(screen.getByText(/incorrect pin/i)).toBeInTheDocument();
  });

  it('exports successfully with the correct device PIN', async () => {
    await setupPin('4242');
    const user = userEvent.setup();
    render(<ExportSettings entries={[createNote('x', 'device-1')]} />);
    await user.type(screen.getByPlaceholderText('Enter device PIN'), '4242');
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(screen.queryByText(/incorrect pin/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npm test -- ExportSettings`
Expected: FAIL — `src/components/ExportSettings.tsx` does not exist yet.

- [ ] **Step 7: Write `src/components/ExportSettings.tsx`**

```tsx
import { useState, FormEvent } from 'react';
import { Entry } from '../models/entry';
import { createBackup } from '../backup/backup';
import { unlockWithPin } from '../auth/pin';

interface ExportSettingsProps {
  entries: Entry[];
}

export function ExportSettings({ entries }: ExportSettingsProps) {
  const [choice, setChoice] = useState<'pin' | 'passphrase'>('pin');
  const [secret, setSecret] = useState('');
  const [confirmSecret, setConfirmSecret] = useState('');
  const [error, setError] = useState('');

  async function handleExport(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (choice === 'passphrase' && secret !== confirmSecret) {
      setError('Passphrases do not match.');
      return;
    }
    if (choice === 'pin') {
      const verified = await unlockWithPin(secret);
      if (!verified) {
        setError('Incorrect PIN.');
        return;
      }
    }
    const backup = await createBackup(secret, entries);
    const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jotterpad-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <form onSubmit={handleExport}>
      <h2>Export Backup</h2>
      <p role="alert">
        If you lose this PIN or passphrase, this backup file is permanently unrecoverable.
      </p>
      <label>
        <input type="radio" checked={choice === 'pin'} onChange={() => setChoice('pin')} />
        Use device PIN
      </label>
      <label>
        <input type="radio" checked={choice === 'passphrase'} onChange={() => setChoice('passphrase')} />
        Set a passphrase for this file
      </label>
      <input
        type="password"
        placeholder={choice === 'pin' ? 'Enter device PIN' : 'Enter passphrase'}
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
      />
      {choice === 'passphrase' && (
        <input
          type="password"
          placeholder="Confirm passphrase"
          value={confirmSecret}
          onChange={(e) => setConfirmSecret(e.target.value)}
        />
      )}
      {error && <p>{error}</p>}
      <button type="submit">Export</button>
    </form>
  );
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test -- ExportSettings`
Expected: PASS (4 tests)

- [ ] **Step 9: Write the failing tests for `ImportBackup`**

```tsx
// src/components/ImportBackup.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { ImportBackup } from './ImportBackup';
import { createBackup } from '../backup/backup';
import { createNote } from '../models/entry';
import { deriveKey } from '../crypto/crypto';

function makeFile(contents: string): File {
  return new File([contents], 'backup.json', { type: 'application/json' });
}

describe('ImportBackup', () => {
  it('merges a valid backup and calls onImported', async () => {
    const backup = await createBackup('correct secret', [createNote('imported thought', 'device-1')]);
    const { key } = await deriveKey('local-pin');
    const user = userEvent.setup();
    const onImported = vi.fn();

    render(<ImportBackup cryptoKey={key} localEntries={[]} onImported={onImported} />);
    await user.type(screen.getByPlaceholderText('PIN or passphrase used for this backup'), 'correct secret');
    await user.upload(
      screen.getByLabelText('backup file'),
      makeFile(JSON.stringify(backup))
    );

    expect(onImported).toHaveBeenCalledTimes(1);
    const [merged] = onImported.mock.calls[0];
    expect(merged.some((e: { text: string }) => e.text === 'imported thought')).toBe(true);
  });

  it('shows an error for the wrong secret', async () => {
    const backup = await createBackup('correct secret', [createNote('x', 'device-1')]);
    const { key } = await deriveKey('local-pin');
    const user = userEvent.setup();

    render(<ImportBackup cryptoKey={key} localEntries={[]} onImported={vi.fn()} />);
    await user.type(screen.getByPlaceholderText('PIN or passphrase used for this backup'), 'wrong secret');
    await user.upload(
      screen.getByLabelText('backup file'),
      makeFile(JSON.stringify(backup))
    );

    expect(await screen.findByText(/could not decrypt/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 10: Run tests to verify they fail**

Run: `npm test -- ImportBackup`
Expected: FAIL — `src/components/ImportBackup.tsx` does not exist yet.

- [ ] **Step 11: Write `src/components/ImportBackup.tsx`**

```tsx
import { useState, ChangeEvent } from 'react';
import { Entry } from '../models/entry';
import { BackupFile, restoreBackup } from '../backup/backup';
import { mergeEntries, ConflictPair } from '../sync/merge';
import { saveEntry } from '../storage/entryRepository';

interface ImportBackupProps {
  cryptoKey: CryptoKey;
  localEntries: Entry[];
  onImported: (merged: Entry[], conflicts: ConflictPair[]) => void;
}

export function ImportBackup({ cryptoKey, localEntries, onImported }: ImportBackupProps) {
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    setError('');
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const backupFile = JSON.parse(text) as BackupFile;
    try {
      const imported = await restoreBackup(secret, backupFile);
      const { merged, conflicts } = mergeEntries(localEntries, imported, 0);
      for (const entry of merged) {
        await saveEntry(cryptoKey, entry);
      }
      onImported(merged, conflicts);
    } catch {
      setError('Could not decrypt this backup. Check the PIN/passphrase.');
    }
  }

  return (
    <div>
      <h2>Import Backup</h2>
      <input
        type="password"
        placeholder="PIN or passphrase used for this backup"
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
      />
      <label htmlFor="backup-file-input">backup file</label>
      <input id="backup-file-input" aria-label="backup file" type="file" accept="application/json" onChange={handleFile} />
      {error && <p>{error}</p>}
    </div>
  );
}
```

- [ ] **Step 12: Run tests to verify they pass**

Run: `npm test -- ImportBackup`
Expected: PASS (2 tests)

- [ ] **Step 13: Commit**

```bash
git add src/backup/backup.ts src/backup/backup.test.ts src/components/ExportSettings.tsx src/components/ExportSettings.test.tsx src/components/ImportBackup.tsx src/components/ImportBackup.test.tsx
git commit -m "feat: add encrypted export/import backup flow"
```

---

## Task 13: Reminders

**Files:**
- Create: `src/notifications/reminders.ts`
- Test: `src/notifications/reminders.test.ts`
- Create: `src/components/ReminderSettings.tsx`

**Interfaces:**
- Consumes: `Entry` from `src/models/entry.ts` (Task 3).
- Produces: `requestNotificationPermission(): Promise<NotificationPermission>`; `scheduleEventReminders(events: Entry[]): void`; `ReminderSettings()`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/notifications/reminders.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { requestNotificationPermission, scheduleEventReminders } from './reminders';
import { createEvent } from '../models/entry';

describe('reminders', () => {
  const notificationSpy = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-23T12:00:00Z'));
    // @ts-expect-error test stub for the global Notification API
    global.Notification = vi.fn().mockImplementation((...args) => notificationSpy(...args));
    // @ts-expect-error test stub
    global.Notification.permission = 'granted';
    // @ts-expect-error test stub
    global.Notification.requestPermission = vi.fn().mockResolvedValue('granted');
    notificationSpy.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('requests permission via the Notification API', async () => {
    const result = await requestNotificationPermission();
    expect(result).toBe('granted');
  });

  it('schedules a notification for an event happening within 24 hours', () => {
    const event = createEvent('dentist', '2026-07-23', '18:00', 'device-1');
    scheduleEventReminders([event]);
    vi.advanceTimersByTime(6 * 60 * 60 * 1000 + 1000);
    expect(notificationSpy).toHaveBeenCalledWith('Jotterpad reminder', { body: 'dentist' });
  });

  it('does not schedule a notification for an event more than 24 hours away', () => {
    const event = createEvent('far future', '2026-08-01', '09:00', 'device-1');
    scheduleEventReminders([event]);
    vi.advanceTimersByTime(48 * 60 * 60 * 1000);
    expect(notificationSpy).not.toHaveBeenCalled();
  });

  it('does not schedule a notification for a past event', () => {
    const event = createEvent('already happened', '2026-07-20', '09:00', 'device-1');
    scheduleEventReminders([event]);
    vi.advanceTimersByTime(48 * 60 * 60 * 1000);
    expect(notificationSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- reminders`
Expected: FAIL — `src/notifications/reminders.ts` does not exist yet.

- [ ] **Step 3: Write `src/notifications/reminders.ts`**

```ts
import { Entry } from '../models/entry';

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied';
  return Notification.requestPermission();
}

export function scheduleEventReminders(events: Entry[]): void {
  events
    .filter((e) => e.type === 'event' && !e.deleted && e.eventDate)
    .forEach((event) => {
      const when = new Date(`${event.eventDate}T${event.eventTime || '00:00'}`).getTime();
      const delay = when - Date.now();
      if (delay > 0 && delay < 24 * 60 * 60 * 1000) {
        setTimeout(() => {
          if (Notification.permission === 'granted') {
            new Notification('Jotterpad reminder', { body: event.text });
          }
        }, delay);
      }
    });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- reminders`
Expected: PASS (4 tests)

- [ ] **Step 5: Write `src/components/ReminderSettings.tsx`**

```tsx
import { useState } from 'react';
import { requestNotificationPermission } from '../notifications/reminders';

export function ReminderSettings() {
  const [status, setStatus] = useState<NotificationPermission | 'unrequested'>('unrequested');

  async function handleRequest() {
    setStatus(await requestNotificationPermission());
  }

  return (
    <div>
      <h2>Reminders</h2>
      <p>
        Reminders only fire while Jotterpad is open or running in the background, per your
        browser's own support. They are not guaranteed to fire if the app is fully closed,
        especially on iOS.
      </p>
      <button onClick={handleRequest}>Enable reminders</button>
      <p>Status: {status}</p>
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add src/notifications/reminders.ts src/notifications/reminders.test.ts src/components/ReminderSettings.tsx
git commit -m "feat: add local event reminders"
```

---

## Task 14: App Wiring and PWA Finalization

**Files:**
- Modify: `src/App.tsx` (replaces the Task 1 placeholder entirely)
- Modify: `vite.config.ts:1-20` (finalize PWA manifest with icons)
- Create: `public/icon.svg`
- Modify: `src/App.test.tsx` (replaces the Task 1 placeholder test)

**Interfaces:**
- Consumes: everything produced by Tasks 2–13.
- Produces: the fully wired `App` default export.

- [ ] **Step 1: Write `public/icon.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192">
  <rect width="192" height="192" rx="24" fill="#1c1c1e"/>
  <text x="96" y="120" font-size="96" text-anchor="middle" fill="#ffffff" font-family="sans-serif">J</text>
</svg>
```

- [ ] **Step 2: Update `vite.config.ts` manifest icons**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Jotterpad',
        short_name: 'Jotterpad',
        theme_color: '#1c1c1e',
        background_color: '#1c1c1e',
        display: 'standalone',
        icons: [
          { src: '/icon.svg', sizes: '192x192', type: 'image/svg+xml' },
          { src: '/icon.svg', sizes: '512x512', type: 'image/svg+xml' },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
  },
});
```

- [ ] **Step 3: Rewrite the failing test `src/App.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import App from './App';
import { getDb } from './storage/db';

async function resetDb() {
  const db = await getDb();
  await db.clear('entries');
  await db.clear('meta');
}

describe('App', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('shows the PIN setup screen when no PIN is configured', async () => {
    render(<App />);
    expect(await screen.findByText(/permanently unrecoverable/i)).toBeInTheDocument();
  });

  it('unlocks into the timeline after setting a PIN, and a captured note appears', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByPlaceholderText('PIN'), '1234');
    await user.type(screen.getByPlaceholderText('Confirm PIN'), '1234');
    await user.click(screen.getByRole('button', { name: 'Set PIN' }));

    await user.type(await screen.findByPlaceholderText('Jot a thought...'), 'first captured thought');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('first captured thought')).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test -- App`
Expected: FAIL — `App` still renders only the Task 1 placeholder heading.

- [ ] **Step 5: Rewrite `src/App.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { LockScreen } from './components/LockScreen';
import { Timeline } from './components/Timeline';
import { SearchBar } from './components/SearchBar';
import { TagFilterBar } from './components/TagFilterBar';
import { SyncScreen } from './components/SyncScreen';
import { ConflictResolver } from './components/ConflictResolver';
import { ExportSettings } from './components/ExportSettings';
import { ImportBackup } from './components/ImportBackup';
import { ReminderSettings } from './components/ReminderSettings';
import { isPinConfigured } from './auth/pin';
import { getOrCreateDeviceId } from './storage/db';
import { getAllEntries, saveEntry, deleteEntry } from './storage/entryRepository';
import { createNote, createEvent, filterEntries, Entry } from './models/entry';
import { ConflictPair } from './sync/merge';
import { scheduleEventReminders } from './notifications/reminders';

export default function App() {
  const [cryptoKey, setCryptoKey] = useState<CryptoKey | null>(null);
  const [pinConfigured, setPinConfigured] = useState<boolean | null>(null);
  const [deviceId, setDeviceId] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [conflicts, setConflicts] = useState<ConflictPair[]>([]);
  const [query, setQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showSync, setShowSync] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    isPinConfigured().then(setPinConfigured);
    getOrCreateDeviceId().then(setDeviceId);
  }, []);

  useEffect(() => {
    if (!cryptoKey) return;
    getAllEntries(cryptoKey).then((loaded) => {
      setEntries(loaded);
      scheduleEventReminders(loaded);
    });
  }, [cryptoKey]);

  if (pinConfigured === null) return null;
  if (!cryptoKey) {
    return <LockScreen mode={pinConfigured ? 'unlock' : 'setup'} onUnlock={setCryptoKey} />;
  }

  const visible = filterEntries(entries.filter((e) => !e.deleted), query, selectedTags);
  const allTags = Array.from(new Set(entries.flatMap((e) => e.tags)));

  function handleMerged(merged: Entry[], newConflicts: ConflictPair[]) {
    setEntries(merged);
    setConflicts((prev) => [...prev, ...newConflicts]);
  }

  async function handleResolve(entry: Entry) {
    await saveEntry(cryptoKey!, entry);
    setEntries((prev) => [...prev.filter((e) => e.id !== entry.id), entry]);
    setConflicts((prev) => prev.slice(1));
  }

  async function handleAddNote(rawText: string) {
    const entry = createNote(rawText, deviceId);
    await saveEntry(cryptoKey!, entry);
    setEntries((prev) => [...prev, entry]);
  }

  async function handleAddEvent(rawText: string, eventDate: string, eventTime: string) {
    const entry = createEvent(rawText, eventDate, eventTime, deviceId);
    await saveEntry(cryptoKey!, entry);
    setEntries((prev) => [...prev, entry]);
  }

  async function handleDelete(id: string) {
    setEntries(await deleteEntry(cryptoKey!, entries, id));
  }

  return (
    <div className="app">
      <header>
        <h1>Jotterpad</h1>
        <button onClick={() => setShowSync(true)}>Sync</button>
        <button onClick={() => setShowSettings(true)}>Settings</button>
      </header>
      <SearchBar value={query} onChange={setQuery} />
      <TagFilterBar
        tags={allTags}
        selected={selectedTags}
        onToggle={(tag) =>
          setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]))
        }
      />
      <Timeline
        entries={visible}
        onAddNote={handleAddNote}
        onAddEvent={handleAddEvent}
        onDelete={handleDelete}
      />
      {conflicts.length > 0 && <ConflictResolver conflicts={conflicts} onResolve={handleResolve} />}
      {showSync && (
        <SyncScreen
          entries={entries}
          deviceId={deviceId}
          cryptoKey={cryptoKey}
          onMerged={handleMerged}
          onClose={() => setShowSync(false)}
        />
      )}
      {showSettings && (
        <div className="settings">
          <ExportSettings entries={entries} />
          <ImportBackup cryptoKey={cryptoKey} localEntries={entries} onImported={handleMerged} />
          <ReminderSettings />
          <button onClick={() => setShowSettings(false)}>Close</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — the full suite passes, including the rewritten `App` tests.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/App.test.tsx vite.config.ts public/icon.svg
git commit -m "feat: wire full app shell and finalize PWA manifest"
```

- [ ] **Step 8: Manual verification checklist**

Run: `npm run build && npm run dev`, then in a browser:
1. Confirm the app installs (desktop Chrome install icon in the address bar; "Add to Home Screen" on mobile Safari/Chrome).
2. Set up a PIN, capture a note and a future event, confirm both appear in the correct positions in the timeline.
3. Filter by tag and by search text; confirm results match expectations.
4. Export a backup using the device PIN, then again using a one-off passphrase; confirm both downloads succeed and the unrecoverability warning is visible both times.
5. Import each backup file back in (with the right secret) and confirm entries reappear; try importing with a wrong secret and confirm the decrypt-failure message shows.
6. Enable reminders and confirm the permission prompt and caveat text appear.
7. Repeat the two-device QR sync flow from Task 11's manual verification once more end-to-end after all features are wired in.

---

## Self-Review Notes

- **Spec coverage:** Overview/architecture → Tasks 1, 14. Security (PIN, encryption, warnings) → Tasks 2, 5, 6, 12. Data model → Task 3. Sync protocol (QR, merge, first-sync-is-full-merge) → Tasks 7, 8, 11. UI (timeline, capture bar, future events, tag/search, lock screen, export/import, reminder caveat) → Tasks 6, 9, 10, 11, 12, 13. Tech stack → Task 1 (scaffold), 11 (qrcode/jsqr). Testing approach (merge + crypto prioritized, QR flow manual) → reflected throughout, explicit in Task 11.
- **Placeholder scan:** no TBD/TODO markers; every step has runnable code.
- **Type consistency:** `Entry` (Task 3) is used identically across Tasks 4–14. `ConflictPair`/`MergeResult` (Task 7) match usage in Tasks 11, 12, 14. `SyncBundle` (Task 11) matches its use in `SyncScreen`. `Timeline`'s prop signature (Task 9) matches how `App` (Task 14) calls it. `deleteEntry`'s return type (full updated array, Task 4) matches how `App.handleDelete` assigns it directly to `entries` state.
