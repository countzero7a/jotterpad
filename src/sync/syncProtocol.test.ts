import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { selectChangedSince, mergeEntries } from './merge';
import { chunkPayload, parseFrame, FrameReassembler } from './qrProtocol';
import { createNote, Entry } from '../models/entry';

interface VirtualDevice {
  id: string;
  entries: Entry[];
  lastSyncAt: number;
  lastSentAt: number;
}

function show(device: VirtualDevice): string[] {
  const changed = selectChangedSince(device.entries, device.lastSentAt);
  const bundle = { senderDeviceId: device.id, entries: changed };
  return chunkPayload(bundle, crypto.randomUUID());
}

function markSent(device: VirtualDevice): void {
  device.lastSentAt = Date.now();
}

function scan(device: VirtualDevice, frames: string[]): void {
  const reassembler = new FrameReassembler();
  frames.forEach((f) => reassembler.addFrame(parseFrame(f)));
  const bundle = reassembler.getResult<{ senderDeviceId: string; entries: Entry[] }>();
  const { merged } = mergeEntries(device.entries, bundle.entries, device.lastSyncAt);
  device.entries = merged;
  device.lastSyncAt = Date.now();
}

// Real syncs are separated by camera-scan time (hundreds of ms to seconds), so
// consecutive Date.now() reads always land in different milliseconds. These
// tests run every step synchronously in the same tick, so without a controlled
// clock two Date.now() calls a few lines apart can land in the SAME
// millisecond (observed in practice), which makes a strict `modifiedAt >
// watermark` comparison flake depending on how fast the test happens to run.
// Fake timers make each step's timestamp deterministic and strictly
// increasing, matching how the real world actually behaves, without changing
// any of the logic under test.
function tick(ms = 10): void {
  vi.advanceTimersByTime(ms);
}

describe('two-device sync protocol round trip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 23, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('preserves both sides notes through a scan-then-show session', () => {
    const a: VirtualDevice = {
      id: 'device-a',
      entries: [createNote('A note 1', 'device-a'), createNote('A note 2', 'device-a')],
      lastSyncAt: 0,
      lastSentAt: 0,
    };
    tick();
    const b: VirtualDevice = {
      id: 'device-b',
      entries: [createNote('B note 1', 'device-b')],
      lastSyncAt: 0,
      lastSentAt: 0,
    };
    tick();

    // Session 1: A shows, B scans (receives A's notes) — B's own note is untouched by this.
    const aFrames = show(a);
    tick();
    markSent(a);
    tick();
    scan(b, aFrames);
    tick();

    // Then, in the SAME session, B shows its own changes. This is the exact scenario that
    // was broken: B just bumped its lastSyncAt during the scan above. If prepareOutgoingBundle
    // had used lastSyncAt (the old, buggy behavior), B's own note would now be excluded.
    const bFrames = show(b);
    tick();
    markSent(b);
    tick();
    scan(a, bFrames);

    const aTexts = a.entries.map((e) => e.text).sort();
    const bTexts = b.entries.map((e) => e.text).sort();
    expect(aTexts).toEqual(['A note 1', 'A note 2', 'B note 1']);
    expect(bTexts).toEqual(['A note 1', 'A note 2', 'B note 1']);
  });

  it('does not resend already-sent entries in a later session, but does send new ones', () => {
    const a: VirtualDevice = {
      id: 'device-a',
      entries: [createNote('A note 1', 'device-a')],
      lastSyncAt: 0,
      lastSentAt: 0,
    };
    tick();
    const b: VirtualDevice = { id: 'device-b', entries: [], lastSyncAt: 0, lastSentAt: 0 };
    tick();

    // Session 1: full exchange.
    scan(b, show(a));
    tick();
    markSent(a);
    tick();
    scan(a, show(b));
    tick();
    markSent(b);
    tick();

    // Session 2: nothing new — both outgoing bundles should be empty.
    const aFramesEmpty = show(a);
    const bFramesEmpty = show(b);
    const reassemblerA = new FrameReassembler();
    aFramesEmpty.forEach((f) => reassemblerA.addFrame(parseFrame(f)));
    const reassemblerB = new FrameReassembler();
    bFramesEmpty.forEach((f) => reassemblerB.addFrame(parseFrame(f)));
    expect(reassemblerA.getResult<{ entries: Entry[] }>().entries).toEqual([]);
    expect(reassemblerB.getResult<{ entries: Entry[] }>().entries).toEqual([]);
    tick();

    // Session 3: A adds a new note. Only the new note should go out.
    a.entries.push(createNote('A note 2', 'device-a'));
    const aFramesNew = show(a);
    const reassemblerA2 = new FrameReassembler();
    aFramesNew.forEach((f) => reassemblerA2.addFrame(parseFrame(f)));
    const sent = reassemblerA2.getResult<{ entries: Entry[] }>().entries;
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toBe('A note 2');
  });
});
