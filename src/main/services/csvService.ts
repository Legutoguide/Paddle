import Papa from 'papaparse';
import fs from 'node:fs';
import type { CouponWithDetails, UsageHistoryEntry, ImportPreview, ImportRowResult } from '../../shared/types/domain';
import { fromCents } from '../../shared/lib/pricing';
import { sanitizePrefix } from '../../shared/lib/codeGenerator';

export function exportCouponsToCsv(coupons: CouponWithDetails[], currency: string): string {
  const rows = coupons.map((c) => ({
    Code: c.code,
    Sponsor: c.sponsorName,
    Campaign: c.campaignName,
    Service: c.serviceName,
    OriginalPrice: `${fromCents(c.originalPriceCents).toFixed(2)} ${currency}`,
    DiscountPercentage: `${c.discountPercentage}%`,
    FinalPrice: `${fromCents(c.finalPriceCents).toFixed(2)} ${currency}`,
    Status: c.status,
    CreatedAt: c.createdAt,
    ExpiresAt: c.expiresAt ?? '',
    UsedAt: c.usedAt ?? '',
    RevokedAt: c.revokedAt ?? '',
  }));
  return Papa.unparse(rows);
}

export function exportHistoryToCsv(entries: UsageHistoryEntry[], currency: string): string {
  const rows = entries.map((h) => ({
    Code: h.code,
    Sponsor: h.sponsorName,
    Campaign: h.campaignName,
    OriginalPrice: `${fromCents(h.originalPriceCents).toFixed(2)} ${currency}`,
    DiscountPercentage: `${h.discountPercentage}%`,
    FinalPrice: `${fromCents(h.finalPriceCents).toFixed(2)} ${currency}`,
    UsedAt: h.usedAt,
    Operator: h.operator ?? '',
  }));
  return Papa.unparse(rows);
}

export function writeCsvFile(path: string, csv: string): void {
  fs.writeFileSync(path, csv, 'utf-8');
}

/**
 * Parse a CSV of codes to import (expects a "code" column, case-insensitive;
 * also accepts a single unlabeled column). Validates format and flags
 * duplicates within the file itself, deferring "already exists in DB" checks
 * to the caller (which has DB access) via existsFn.
 */
export function parseImportCsv(
  csvContent: string,
  existsFn: (code: string) => boolean
): ImportPreview {
  const parsed = Papa.parse<Record<string, string>>(csvContent.trim(), {
    header: true,
    skipEmptyLines: true,
  });

  const valid: ImportRowResult[] = [];
  const duplicatesInFile: ImportRowResult[] = [];
  const alreadyExists: ImportRowResult[] = [];
  const invalid: ImportRowResult[] = [];
  const seenInFile = new Set<string>();

  const codeKey = parsed.meta.fields?.find((f) => f.toLowerCase() === 'code') ?? parsed.meta.fields?.[0];

  parsed.data.forEach((rawRow, index) => {
    const rowNumber = index + 2; // header is row 1
    const rawCode = codeKey ? rawRow[codeKey] : undefined;
    const code = sanitizePrefix(rawCode)
      ? rawCode!.trim().toUpperCase()
      : (rawCode ?? '').trim().toUpperCase();

    if (!code || !/^[A-Z0-9-]{3,32}$/.test(code)) {
      invalid.push({ row: rowNumber, code: rawCode ?? '', status: 'INVALID', reason: 'Invalid code format' });
      return;
    }

    if (seenInFile.has(code)) {
      duplicatesInFile.push({ row: rowNumber, code, status: 'DUPLICATE_IN_FILE', reason: 'Duplicate within file' });
      return;
    }
    seenInFile.add(code);

    if (existsFn(code)) {
      alreadyExists.push({ row: rowNumber, code, status: 'ALREADY_EXISTS', reason: 'Code already exists in database' });
      return;
    }

    valid.push({ row: rowNumber, code, status: 'VALID' });
  });

  return {
    totalRows: parsed.data.length,
    valid,
    duplicatesInFile,
    alreadyExists,
    invalid,
  };
}
