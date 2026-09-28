// Coupon code generation.
// Produces codes like "ADAM-X7K29": an optional prefix, a dash, and a
// cryptographically random suffix drawn from an unambiguous alphabet
// (no 0/O, 1/I/L confusion) to stay reliable when read/typed by humans.

import { randomInt } from 'crypto';

// Unambiguous uppercase alphanumeric alphabet (removes 0, O, 1, I, L).
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const DEFAULT_SUFFIX_LENGTH = 5;
const MAX_REGENERATION_ATTEMPTS = 25;

export function randomSuffix(length: number = DEFAULT_SUFFIX_LENGTH): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[randomInt(0, ALPHABET.length)];
  }
  return out;
}

/** Sanitize a user-supplied prefix: uppercase, alphanumeric only, max 12 chars. */
export function sanitizePrefix(prefix: string | undefined | null): string {
  if (!prefix) return '';
  return prefix
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
}

export function buildCode(prefix: string, suffix: string): string {
  return prefix ? `${prefix}-${suffix}` : suffix;
}

/**
 * Generate `count` unique codes given a function that checks whether a
 * candidate code already exists (e.g. a DB lookup). Guarantees no duplicates
 * within the returned batch and retries on collision against the existence
 * check, up to a bounded number of attempts per code.
 *
 * Throws if it cannot produce a unique code within the attempt budget, so
 * callers can roll back the whole batch rather than persist a partial set.
 */
export function generateUniqueCodes(params: {
  count: number;
  prefix?: string;
  existsFn: (code: string) => boolean;
  suffixLength?: number;
}): string[] {
  const { count, existsFn } = params;
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error('count must be a positive integer');
  }
  if (count > 100000) {
    throw new Error('count exceeds the maximum supported batch size (100000)');
  }

  const prefix = sanitizePrefix(params.prefix);
  let suffixLength = params.suffixLength ?? DEFAULT_SUFFIX_LENGTH;

  const generated = new Set<string>();
  const results: string[] = [];

  for (let i = 0; i < count; i++) {
    let code: string | null = null;
    let attempts = 0;

    while (attempts < MAX_REGENERATION_ATTEMPTS) {
      const candidate = buildCode(prefix, randomSuffix(suffixLength));
      attempts++;
      if (generated.has(candidate) || existsFn(candidate)) {
        continue;
      }
      code = candidate;
      break;
    }

    if (!code) {
      // Extremely unlikely with the default alphabet/length, but if the
      // keyspace is getting crowded (huge batches), widen it and retry once
      // more rather than fail the whole batch outright.
      suffixLength += 1;
      const candidate = buildCode(prefix, randomSuffix(suffixLength));
      if (generated.has(candidate) || existsFn(candidate)) {
        throw new Error(
          `Unable to generate a unique code after ${MAX_REGENERATION_ATTEMPTS} attempts (item ${i + 1} of ${count}). Batch aborted, no codes were saved.`
        );
      }
      code = candidate;
    }

    generated.add(code);
    results.push(code);
  }

  return results;
}
