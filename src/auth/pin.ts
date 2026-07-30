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
