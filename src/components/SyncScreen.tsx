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
