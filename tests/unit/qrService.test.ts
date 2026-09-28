import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { generateQrDataUrl, generateQrPngBuffer, generateQrSvgString } from '../../src/main/services/qrService';

describe('qrService', () => {
  test('generates a data URL', async () => {
    const url = await generateQrDataUrl('ADAM-X7K29');
    assert.match(url, /^data:image\/png;base64,/);
  });

  test('generates a valid SVG element', async () => {
    const svg = await generateQrSvgString('ADAM-X7K29');
    assert.match(svg, /<svg/);
  });

  test('round-trip: PNG buffer decodes back to the exact original code (not a URL)', async () => {
    const buffer = await generateQrPngBuffer('ADAM-X7K29', { sizePx: 300 });
    const png = PNG.sync.read(buffer);
    const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    assert.ok(decoded, 'QR should be decodable');
    assert.equal(decoded!.data, 'ADAM-X7K29');
  });

  test('two different codes produce different QR images', async () => {
    const a = await generateQrDataUrl('ADAM-AAAAA');
    const b = await generateQrDataUrl('ADAM-BBBBB');
    assert.notEqual(a, b);
  });
});
