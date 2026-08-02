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

  it('throws when seq is >= total', () => {
    expect(() =>
      parseFrame(JSON.stringify({ seq: 5, total: 3, sessionId: 'x', payload: 'y' }))
    ).toThrow('Invalid QR frame');
    expect(() =>
      parseFrame(JSON.stringify({ seq: 3, total: 3, sessionId: 'x', payload: 'y' }))
    ).toThrow('Invalid QR frame');
  });

  it('throws when seq is negative', () => {
    expect(() =>
      parseFrame(JSON.stringify({ seq: -1, total: 3, sessionId: 'x', payload: 'y' }))
    ).toThrow('Invalid QR frame');
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

  it('detects false completion: explicit index check prevents seq overflow', () => {
    const bigArray = Array.from({ length: 100 }, (_, i) => ({ id: i, text: 'x'.repeat(20) }));
    const frames = chunkPayload(bigArray, 'session-5').map(parseFrame);
    const frameCount = frames.length;

    const reassembler = new FrameReassembler();
    const realLastIndex = frameCount - 1;

    for (let i = 0; i < realLastIndex; i++) {
      reassembler.addFrame(frames[i]);
    }

    const bogusFrame: QrFrame = {
      seq: frameCount,
      total: frameCount,
      sessionId: 'session-5',
      payload: 'wrong-payload',
    };

    reassembler.addFrame(bogusFrame);

    expect(reassembler.isComplete()).toBe(false);
  });
});
