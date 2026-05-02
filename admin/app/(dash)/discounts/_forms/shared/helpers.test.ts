// admin/app/(dash)/discounts/_forms/shared/helpers.test.ts
import { describe, expect, test } from 'bun:test';
import { deriveCode, randomCode, formatCents, parseCents } from './helpers';

describe('deriveCode', () => {
  test('drops accents and stopwords', () => {
    expect(deriveCode('Promo de printemps')).toBe('PROMOPRINTEMPS');
  });
  test('drops English stopwords', () => {
    expect(deriveCode('the spring sale')).toBe('SPRINGSALE');
  });
  test('caps at 20 chars', () => {
    expect(deriveCode('a').length).toBeGreaterThan(0);
    const long = deriveCode('Supercalifragilistic Expialidocious Promotion');
    expect(long.length).toBeLessThanOrEqual(20);
  });
  test('only stopwords → PROMO + random', () => {
    const r = deriveCode('the and of');
    expect(r.startsWith('PROMO')).toBe(true);
    expect(r.length).toBe(9);
  });
  test('preserves digits', () => {
    expect(deriveCode('Sale 2026')).toBe('SALE2026');
  });
  test('strips punctuation and whitespace', () => {
    expect(deriveCode('Promo!! de printemps...')).toBe('PROMOPRINTEMPS');
  });
});

describe('randomCode', () => {
  test('format: 5+ letters then 2 digits', () => {
    const r = randomCode();
    expect(r).toMatch(/^[A-Z]{4,6}\d{2}$/);
  });
});

describe('formatCents / parseCents', () => {
  test('formatCents', () => {
    expect(formatCents(4720)).toBe('47.20');
    expect(formatCents(0)).toBe('0.00');
  });
  test('parseCents handles empty', () => {
    expect(parseCents('')).toBeNull();
    expect(parseCents('  ')).toBeNull();
  });
  test('parseCents rounds correctly', () => {
    expect(parseCents('47.20')).toBe(4720);
    expect(parseCents('0.999')).toBe(100); // rounds .999 → 1.00 → 100c
  });
  test('parseCents throws on NaN', () => {
    expect(() => parseCents('abc')).toThrow();
  });
});
