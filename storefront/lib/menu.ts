// Helpers to fetch a navigation menu from the backend and resolve each
// item's href according to its link_type. Runs server-side (layout.tsx
// is a Server Component), so this file shouldn't import browser APIs.

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

export type MenuItem = {
  id: string;
  label: string;
  linkType:
    | 'url' | 'page' | 'collection' | 'product'
    | 'blog' | 'blog_post' | 'menu_header';
  target: string;
  openInNewTab: boolean;
  children?: MenuItem[];
};

export type Menu = {
  handle: string;
  name: string;
  items: MenuItem[];
};

// hrefFor resolves a menu item's storefront URL. Returns empty string for
// 'menu_header' (non-clickable section label) — the caller should render
// that as plain text.
export function hrefFor(item: MenuItem): string {
  switch (item.linkType) {
    case 'url':         return item.target;
    case 'page':        return `/pages/${item.target}`;
    case 'collection':  return `/collections/${item.target}`;
    case 'product':     return `/products/${item.target}`;
    case 'blog':        return '/blog';
    case 'blog_post':   return `/blog/${item.target}`;
    case 'menu_header': return '';
  }
}

// Fetch a menu by handle. Returns an empty menu when the backend returns
// 404 or errors — the storefront layout should degrade gracefully rather
// than break rendering because the admin hasn't configured the menu yet.
export async function fetchMenu(handle: string): Promise<Menu> {
  try {
    const res = await fetch(`${API}/api/storefront/menus/${encodeURIComponent(handle)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return { handle, name: '', items: [] };
    return res.json();
  } catch {
    return { handle, name: '', items: [] };
  }
}
