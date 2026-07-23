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

  it('round-trips large plaintext (>200KB) without hitting call stack limits', async () => {
    const { key } = await deriveKey('1234');
    const largePlaintext = 'x'.repeat(250_000);
    const combined = await encrypt(key, largePlaintext);
    const result = await decrypt(key, combined);
    expect(result).toBe(largePlaintext);
  });
});
