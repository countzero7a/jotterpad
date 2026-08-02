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
  if (frame.seq < 0 || frame.seq >= frame.total) {
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
    if (this.sessionId === null || this.chunks.size !== this.total) {
      return false;
    }
    for (let i = 0; i < this.total; i++) {
      if (!this.chunks.has(i)) {
        return false;
      }
    }
    return true;
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
