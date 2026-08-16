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
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError('');
    setSubmitting(true);
    try {
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
    } catch (error) {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
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
      <button type="submit" disabled={submitting}>
        {mode === 'setup' ? 'Set PIN' : 'Unlock'}
      </button>
    </form>
  );
}
