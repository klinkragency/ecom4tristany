// admin/app/(dash)/discounts/_forms/shared/helpers.ts

const STOPWORDS = new Set([
  'the','of','a','an','for','and','to','in','on','at','by','with','&',
  'le','la','les','de','des','du','et','aux','au','un','une','en','sur','pour','dans',
]);

const RANDOM_PREFIXES = ['FLASH', 'BURST', 'SAVE', 'DEAL', 'BONUS', 'SPARK', 'SCORE'];

// deriveCode turns a free-form title into a sensible discount code.
// "Promo de printemps 2026" → "PROMOPRINTEMPS2026"
// "the spring sale!" → "SPRINGSALE"
// (only stopwords) → "PROMO" + 4 random alphanum
export function deriveCode(title: string): string {
  const normalized = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase();
  const tokens = normalized
    .split(/[^A-Z0-9]+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t.toLowerCase()));
  if (tokens.length === 0) {
    return 'PROMO' + randomAlphanum(4);
  }
  return tokens.slice(0, 3).join('').slice(0, 20);
}

export function randomCode(): string {
  const prefix = RANDOM_PREFIXES[Math.floor(Math.random() * RANDOM_PREFIXES.length)];
  const suffix = String(Math.floor(Math.random() * 100)).padStart(2, '0');
  return prefix + suffix;
}

function randomAlphanum(n: number): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < n; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// formatCents → "47.20" (no currency symbol — caller adds €)
export function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

// parseCents("47.2") → 4720; "" → null. Throws on NaN.
export function parseCents(s: string): number | null {
  if (s.trim() === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error('not a number');
  return Math.round(n * 100);
}
