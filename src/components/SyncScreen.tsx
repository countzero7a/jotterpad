import { useState } from 'react';
import { Entry } from '../models/entry';
import { ConflictPair } from '../sync/merge';
import { prepareOutgoingBundle, applyScannedBundle, markBundleSent } from '../sync/syncActions';
import { isSyncBundle } from '../sync/validate';
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
  const [sentEntries, setSentEntries] = useState<Entry[]>([]);
  const [preparedAt, setPreparedAt] = useState<number>(0);
  const [scanError, setScanError] = useState<string | null>(null);

  async function startShowing() {
    const {
      frames: outgoingFrames,
      sentEntries: outgoingEntries,
      preparedAt: outgoingPreparedAt,
    } = await prepareOutgoingBundle(deviceId, entries);
    setFrames(outgoingFrames);
    setSentEntries(outgoingEntries);
    setPreparedAt(outgoingPreparedAt);
    setStep('showing');
  }

  async function handleScanned(data: unknown) {
    if (!isSyncBundle(data)) {
      setScanError('That QR sequence was not a valid Jotterpad sync bundle. Try scanning again.');
      setStep('menu');
      return;
    }
    try {
      const { merged, conflicts } = await applyScannedBundle(cryptoKey, entries, data);
      onMerged(merged, conflicts);
    } catch {
      setScanError('Something went wrong applying the scanned data. Nothing was changed.');
    }
    setStep('menu');
  }

  if (step === 'showing') {
    return (
      <QrDisplay
        frames={frames}
        onDone={() => {
          markBundleSent(sentEntries, preparedAt).finally(() => setStep('menu'));
        }}
      />
    );
  }
  if (step === 'scanning') {
    return <QrScanner onComplete={handleScanned} onCancel={() => setStep('menu')} />;
  }
  return (
    <div className="sync-screen">
      <button onClick={startShowing}>Show My Changes</button>
      <button
        onClick={() => {
          setScanError(null);
          setStep('scanning');
        }}
      >
        Scan Partner's Changes
      </button>
      <button onClick={onClose}>Close</button>
      {scanError && <p role="alert">{scanError}</p>}
    </div>
  );
}
