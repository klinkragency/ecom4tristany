// Public storefront URL — used to build "View on storefront" links from the
// admin app. Falls back to the local dev origin when no env override is set.
export function storefrontUrl(): string {
  const u = process.env.NEXT_PUBLIC_STOREFRONT_URL;
  return (u && u.trim()) || 'http://localhost:3000';
}
