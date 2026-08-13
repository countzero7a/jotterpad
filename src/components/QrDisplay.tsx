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
