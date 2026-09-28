import QRCode from 'qrcode';

// The QR payload is ALWAYS the bare coupon code string, e.g. "ADAM-X7K29".
// Never encode a URL or any executable payload: the scanner only ever needs
// to resolve this string against the local coupons table (see couponService).
// This keeps validation logic in one place and avoids any temptation for the
// scanner UI to "open" a scanned QR as a link.

export interface QrOptions {
  sizePx?: number;
  marginModules?: number; // "quiet zone" around the QR, in QR modules
}

export async function generateQrDataUrl(code: string, opts: QrOptions = {}): Promise<string> {
  return QRCode.toDataURL(code, {
    errorCorrectionLevel: 'M',
    width: opts.sizePx ?? 512,
    margin: opts.marginModules ?? 2,
    color: { dark: '#000000', light: '#FFFFFF' },
  });
}

export async function generateQrPngBuffer(code: string, opts: QrOptions = {}): Promise<Buffer> {
  return QRCode.toBuffer(code, {
    type: 'png',
    errorCorrectionLevel: 'M',
    width: opts.sizePx ?? 512,
    margin: opts.marginModules ?? 2,
    color: { dark: '#000000', light: '#FFFFFF' },
  });
}

export async function generateQrSvgString(code: string, opts: QrOptions = {}): Promise<string> {
  return QRCode.toString(code, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    width: opts.sizePx ?? 512,
    margin: opts.marginModules ?? 2,
    color: { dark: '#000000', light: '#FFFFFF' },
  });
}
