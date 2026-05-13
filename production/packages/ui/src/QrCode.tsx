import qrcode from 'qrcode-generator';

/**
 * Server-friendly QR code: returns an inline SVG string. Use with
 * dangerouslySetInnerHTML or wrap in a React component as preferred.
 */
export function QrCode({ value, size = 256, errorCorrectionLevel = 'H' }: { value: string; size?: number; errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' }) {
  const qr = qrcode(0, errorCorrectionLevel);
  qr.addData(value);
  qr.make();
  const svg = qr.createSvgTag({ scalable: true, margin: 0 });
  return <span style={{ display: 'inline-block', width: size, height: size }} aria-label={`QR code: ${value}`} role="img" dangerouslySetInnerHTML={{ __html: svg }} />;
}
