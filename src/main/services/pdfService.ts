import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import type { CouponWithDetails } from '../../shared/types/domain';
import { fromCents } from '../../shared/lib/pricing';
import { generateQrPngBuffer } from './qrService';

// A4 in points (72 pt/inch): 595.28 x 841.89
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 24;

// 2 columns x 3 rows per page = 6 coupons/page. Generous quiet space around
// each QR so it stays scannable after printing.
const COLS = 2;
const ROWS = 3;
const CELL_WIDTH = (PAGE_WIDTH - MARGIN * 2) / COLS;
const CELL_HEIGHT = (PAGE_HEIGHT - MARGIN * 2) / ROWS;
const QR_SIZE = 130;

export interface PdfBrandingOptions {
  businessName: string;
  currency: string;
  /** Organization logo (Settings → Branding). Optional — falls back to text-only if missing/unreadable. */
  orgLogoPath?: string | null;
}

/**
 * Safely read an image file into a Buffer for embedding in the PDF.
 * Missing or unreadable images must NEVER break generation — this always
 * returns null instead of throwing, so callers can just skip the image.
 */
function tryReadImage(path: string | null | undefined): Buffer | null {
  if (!path) return null;
  try {
    return fs.readFileSync(path);
  } catch {
    return null;
  }
}

/**
 * Render a printable A4 sheet of QR coupons, 6 per page, and write it to
 * `outputPath`. Each coupon shows: organization/sponsor branding (logo +
 * a subtle campaign banner wash as background), business name, sponsor,
 * campaign/service, QR code, human-readable code, discount, final price
 * and expiry — with generous spacing so nothing crowds the QR's quiet zone.
 *
 * Missing sponsor/campaign images degrade gracefully to a text-only card;
 * they never break export.
 */
export async function exportCouponsToPdf(
  coupons: CouponWithDetails[],
  outputPath: string,
  branding: PdfBrandingOptions
): Promise<void> {
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, autoFirstPage: false });
  const stream = fs.createWriteStream(outputPath);
  doc.pipe(stream);

  const orgLogoBuffer = tryReadImage(branding.orgLogoPath);
  // Cache per-path image buffers across the batch so repeated sponsors/
  // campaigns in the same run don't re-read the same file from disk.
  const imageCache = new Map<string, Buffer | null>();
  const cachedRead = (path: string | null): Buffer | null => {
    if (!path) return null;
    if (!imageCache.has(path)) imageCache.set(path, tryReadImage(path));
    return imageCache.get(path) ?? null;
  };

  for (let i = 0; i < coupons.length; i++) {
    const positionOnPage = i % (COLS * ROWS);
    if (positionOnPage === 0) doc.addPage();

    const col = positionOnPage % COLS;
    const row = Math.floor(positionOnPage / COLS);
    const cellX = MARGIN + col * CELL_WIDTH;
    const cellY = MARGIN + row * CELL_HEIGHT;

    await drawCoupon(doc, coupons[i], cellX, cellY, branding, orgLogoBuffer, cachedRead);
  }

  doc.end();

  await new Promise<void>((resolve, reject) => {
    stream.on('finish', () => resolve());
    stream.on('error', reject);
  });
}

async function drawCoupon(
  doc: PDFKit.PDFDocument,
  coupon: CouponWithDetails,
  x: number,
  y: number,
  branding: PdfBrandingOptions,
  orgLogoBuffer: Buffer | null,
  cachedRead: (path: string | null) => Buffer | null
): Promise<void> {
  const padding = 12;
  const innerWidth = CELL_WIDTH - padding * 2;
  const cardX = x + 4;
  const cardY = y + 4;
  const cardW = CELL_WIDTH - 8;
  const cardH = CELL_HEIGHT - 8;

  // --- Background wash: the campaign's banner image, faded, behind
  // everything else. Falls back to a plain white card if not set/unreadable.
  const bannerBuffer = cachedRead(coupon.campaignBannerPath);
  if (bannerBuffer) {
    doc.save();
    doc.rect(cardX, cardY, cardW, cardH).clip();
    try {
      doc.opacity(0.14).image(bannerBuffer, cardX, cardY, { width: cardW, height: cardH, cover: [cardW, cardH] });
    } catch {
      // Corrupt/unsupported image format — silently skip the background,
      // never let a bad image file break the export.
    }
    doc.opacity(1);
    doc.restore();
  }

  // Cut-line border for scissors/paper cutter.
  doc.rect(cardX, cardY, cardW, cardH).lineWidth(0.5).strokeColor('#cccccc').stroke();

  let cursorY = y + padding + 4;

  // --- Header: organization logo (if any) beside the business name.
  const logoSize = 16;
  if (orgLogoBuffer) {
    try {
      doc.image(orgLogoBuffer, x + padding, cursorY - 2, { width: logoSize, height: logoSize, fit: [logoSize, logoSize] });
    } catch {
      // Unreadable/unsupported logo format — fall back to text-only header.
    }
  }
  doc
    .fillColor('#111111')
    .font('Helvetica-Bold')
    .fontSize(9)
    .text(branding.businessName.toUpperCase(), x + padding, cursorY, { width: innerWidth, align: 'center' });
  cursorY += 14;

  // --- Sponsor logo (if any), shown prominently above the sponsor/campaign line.
  const sponsorLogoBuffer = cachedRead(coupon.sponsorLogoPath);
  if (sponsorLogoBuffer) {
    const sLogoSize = 26;
    try {
      doc.image(sponsorLogoBuffer, x + (CELL_WIDTH - sLogoSize) / 2, cursorY, {
        width: sLogoSize,
        height: sLogoSize,
        fit: [sLogoSize, sLogoSize],
      });
      cursorY += sLogoSize + 4;
    } catch {
      // Fall through to text-only sponsor line below.
    }
  }

  doc
    .fillColor('#333333')
    .font('Helvetica')
    .fontSize(8)
    .text(`${coupon.sponsorName} · ${coupon.campaignName}`, x + padding, cursorY, {
      width: innerWidth,
      align: 'center',
    });
  cursorY += 16;

  const qrBuffer = await generateQrPngBuffer(coupon.code, { sizePx: 300 });
  const qrX = x + (CELL_WIDTH - QR_SIZE) / 2;
  // White backing behind the QR so a faded background image never reduces
  // scan contrast — the QR itself always sits on a clean white square.
  doc.rect(qrX - 4, cursorY - 4, QR_SIZE + 8, QR_SIZE + 8).fillColor('#ffffff').fill();
  doc.image(qrBuffer, qrX, cursorY, { width: QR_SIZE, height: QR_SIZE });
  cursorY += QR_SIZE + 8;

  doc
    .fillColor('#000000')
    .font('Helvetica-Bold')
    .fontSize(12)
    .text(coupon.code, x + padding, cursorY, { width: innerWidth, align: 'center' });
  cursorY += 18;

  const discountLabel =
    coupon.discountType === 'PERCENTAGE' ? `${coupon.discountPercentage}% OFF` : `DISCOUNT APPLIED`;
  doc
    .fillColor('#b8860b')
    .font('Helvetica-Bold')
    .fontSize(11)
    .text(discountLabel, x + padding, cursorY, { width: innerWidth, align: 'center' });
  cursorY += 14;

  doc
    .fillColor('#111111')
    .font('Helvetica')
    .fontSize(10)
    .text(`${fromCents(coupon.finalPriceCents).toFixed(2)} ${branding.currency}`, x + padding, cursorY, {
      width: innerWidth,
      align: 'center',
    });
  cursorY += 14;

  if (coupon.expiresAt) {
    const date = new Date(coupon.expiresAt);
    doc
      .fillColor('#666666')
      .font('Helvetica')
      .fontSize(7)
      .text(`Valid until: ${date.toLocaleDateString()}`, x + padding, cursorY, {
        width: innerWidth,
        align: 'center',
      });
  }
}
