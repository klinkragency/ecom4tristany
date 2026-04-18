'use client';

import DOMPurify from 'isomorphic-dompurify';

export default function SafeHtml({ html, className }: { html: string; className?: string }) {
  // Content is ALSO sanitized on the backend (bluemonday in Phase 2c). Defense in depth.
  const clean = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  return (
    // eslint-disable-next-line react/no-danger
    <div className={className} dangerouslySetInnerHTML={{ __html: clean }} />
  );
}
