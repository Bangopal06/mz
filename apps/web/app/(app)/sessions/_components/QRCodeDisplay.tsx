'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

interface QRCodeDisplayProps {
  /** The raw QR string received from the gateway */
  qrString: string;
  /** Side length in pixels (default 256) */
  size?: number;
}

/**
 * Renders a QR code from a raw QR string using the `qrcode` package.
 * Draws directly onto a <canvas> element for performance.
 */
export default function QRCodeDisplay({ qrString, size = 256 }: QRCodeDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    setError(null);
    QRCode.toCanvas(canvasRef.current, qrString, {
      width: size,
      margin: 2,
      color: {
        dark: '#111827', // gray-900
        light: '#ffffff',
      },
    }).catch(() => {
      setError('Gagal merender QR code');
    });
  }, [qrString, size]);

  if (error) {
    return (
      <div
        className="flex items-center justify-center bg-gray-100 rounded-xl text-sm text-gray-500"
        style={{ width: size, height: size }}
      >
        {error}
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className="rounded-xl"
      aria-label="QR code untuk pairing WhatsApp"
    />
  );
}
