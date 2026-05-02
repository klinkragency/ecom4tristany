import {
  Home,
  ShoppingBag,
  Package,
  Warehouse,
  Users,
  Tag,
  FileText,
  Globe,
  BarChart3,
  Settings,
  type LucideIcon,
} from 'lucide-react';

export type NavSub = { href: string; label: string };
// A section is either:
//   - a leaf with `href` (no subs)
//   - a group label (no `href`, only `key` + subs). Clicking the group only
//     toggles the dropdown; the primary destination lives as the first sub.
// This avoids the dual-purpose parent (link + toggle) that confused users.
export type NavSection = {
  key: string; // stable id for storage / active checks
  href?: string;
  label: string;
  icon: LucideIcon;
  subs?: NavSub[];
};

export const TOP_NAV: NavSection[] = [
  { key: 'home', href: '/', label: 'Home', icon: Home },
  {
    key: 'sales',
    label: 'Sales',
    icon: ShoppingBag,
    subs: [
      { href: '/orders', label: 'Orders' },
      { href: '/returns', label: 'Returns' },
    ],
  },
  {
    key: 'catalog',
    label: 'Catalog',
    icon: Package,
    subs: [
      { href: '/products', label: 'Products' },
      { href: '/collections', label: 'Collections' },
    ],
  },
  {
    key: 'operations',
    label: 'Operations',
    icon: Warehouse,
    subs: [
      { href: '/inventory', label: 'Inventory' },
      { href: '/inventory/transfers', label: 'Transfers' },
    ],
  },
  {
    key: 'audience',
    label: 'Audience',
    icon: Users,
    subs: [
      { href: '/customers', label: 'Customers' },
      { href: '/segments', label: 'Segments' },
    ],
  },
  { key: 'discounts', href: '/discounts', label: 'Discounts', icon: Tag },
  {
    key: 'content',
    label: 'Content',
    icon: FileText,
    subs: [
      { href: '/content/pages', label: 'Pages' },
      { href: '/content/blog', label: 'Blog posts' },
      { href: '/content/menus', label: 'Menus' },
      { href: '/content/metaobjects', label: 'Metaobjects' },
      { href: '/content/files', label: 'Files' },
    ],
  },
  { key: 'analytics', href: '/analytics', label: 'Analytics', icon: BarChart3 },
];

export const BOTTOM_NAV: NavSection[] = [
  { key: 'settings', href: '/settings', label: 'Settings', icon: Settings },
];

// Returns true when the current pathname matches the section's parent href
// or any of its sub hrefs. Group-only sections (no href) match purely via subs.
export function isSectionActive(pathname: string, section: NavSection): boolean {
  if (section.href && pathname === section.href) return true;
  if (section.subs?.some((s) => pathname === s.href || pathname.startsWith(s.href + '/'))) return true;
  if (section.href && section.href !== '/' && pathname.startsWith(section.href + '/')) return true;
  return false;
}

export function isSubActive(pathname: string, sub: NavSub): boolean {
  return pathname === sub.href || pathname.startsWith(sub.href + '/');
}
