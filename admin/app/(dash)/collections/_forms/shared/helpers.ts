// admin/app/(dash)/collections/_forms/shared/helpers.ts

// slugifyHandle turns "Spring 2026 — Édition limitée" into
// "spring-2026-edition-limitee". Mirrors the server's slug rules so the
// admin can derive a sensible default handle as the user types the title.
export function slugifyHandle(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// deriveHandleFromTitle is just slugifyHandle with a fallback so the
// caller never has to special-case empty strings.
export function deriveHandleFromTitle(title: string): string {
  const slug = slugifyHandle(title);
  return slug || 'collection';
}
