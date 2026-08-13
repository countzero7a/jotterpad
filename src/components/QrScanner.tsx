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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const reassembler = new FrameReassembler();
    let stream: MediaStream | undefined;
    let cancelled = false;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      } catch {
        setError('Camera access failed. Check permissions and try again.');
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
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

    start().catch(() => {
      setError('Camera access failed. Check permissions and try again.');
    });

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onComplete]);

  return (
    <div className="qr-scanner">
      <video ref={videoRef} muted playsInline />
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        <p>{totalFrames ? `Received ${framesReceived} of ${totalFrames} frames` : 'Point camera at QR code...'}</p>
      )}
    </div>
  );
}
