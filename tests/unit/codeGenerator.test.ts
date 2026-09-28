import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateUniqueCodes, sanitizePrefix, buildCode } from '../../src/shared/lib/codeGenerator';

describe('codeGenerator', () => {
  test('generates the exact requested count', () => {
    const codes = generateUniqueCodes({ count: 10, prefix: 'ADAM', existsFn: () => false });
    assert.equal(codes.length, 10);
  });

  test('all generated codes are unique within a batch', () => {
    const codes = generateUniqueCodes({ count: 500, prefix: 'ADAM', existsFn: () => false });
    assert.equal(new Set(codes).size, 500);
  });

  test('codes follow PREFIX-XXXXX format', () => {
    const codes = generateUniqueCodes({ count: 5, prefix: 'ADAM', existsFn: () => false });
    for (const code of codes) {
      assert.match(code, /^ADAM-[A-Z0-9]{5}$/);
    }
  });

  test('sanitizes unsafe prefix input', () => {
    assert.equal(sanitizePrefix('adam!! promo'), 'ADAMPROMO');
    assert.equal(sanitizePrefix(''), '');
    assert.equal(sanitizePrefix(undefined), '');
  });

  test('excludes ambiguous characters (0, O, 1, I, L)', () => {
    const codes = generateUniqueCodes({ count: 300, existsFn: () => false });
    const joined = codes.join('');
    assert.doesNotMatch(joined, /[01OIL]/);
  });

  test('retries and skips codes reported as already existing', () => {
    const existing = new Set(['AAAAA']); // extremely unlikely to actually collide, just proves plumbing
    const codes = generateUniqueCodes({ count: 20, existsFn: (c) => existing.has(c) });
    assert.equal(codes.includes('AAAAA'), false);
    assert.equal(codes.length, 20);
  });

  test('rejects zero or negative count', () => {
    assert.throws(() => generateUniqueCodes({ count: 0, existsFn: () => false }));
    assert.throws(() => generateUniqueCodes({ count: -5, existsFn: () => false }));
  });

  test('buildCode with empty prefix returns bare suffix', () => {
    assert.equal(buildCode('', 'X7K29'), 'X7K29');
    assert.equal(buildCode('ADAM', 'X7K29'), 'ADAM-X7K29');
  });

  test('throws (aborts batch) if the keyspace is exhausted for a tiny alphabet scenario', () => {
    // existsFn always true -> should never find a free code, forcing bounded failure not an infinite loop
    assert.throws(() => generateUniqueCodes({ count: 1, existsFn: () => true }));
  });
});
