import {
  Home,
  ShoppingBag,
  Package,
  Users,
  Tag,
  FileText,
  Globe,
  BarChart3,
  Settings,
  type LucideIcon,
} from 'lucide-react';

export type NavSub = { href: string; label: string };
export type NavSection = {
  href: string;
  label: string;
  icon: LucideIcon;
  subs?: NavSub[];
};

export const TOP_NAV: NavSection[] = [
  { href: '/', label: 'Home', icon: Home },
  {
    href: '/orders',
    label: 'Orders',
    icon: ShoppingBag,
    subs: [
      { href: '/returns', label: 'Returns' },
      // Drafts + Abandoned land here in later phases.
    ],
  },
  {
    href: '/products',
    label: 'Products',
    icon: Package,
    subs: [
      { href: '/collections', label: 'Collections' },
      { href: '/inventory', label: 'Inventory' },
      { href: '/inventory/transfers', label: 'Transfers' },
    ],
  },
  {
    href: '/customers',
    label: 'Customers',
    icon: Users,
    subs: [{ href: '/segments', label: 'Segments' }],
  },
  { href: '/discounts', label: 'Discounts', icon: Tag },
  {
    href: '/content',
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
  { href: '/settings/currencies', label: 'Markets', icon: Globe },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
];

export const BOTTOM_NAV: NavSection[] = [
  { href: '/settings', label: 'Settings', icon: Settings },
];

// Returns true when the current pathname matches the section's parent href
// or any of its sub hrefs (treats parent as a prefix only when no exact
// sub matches first — this is what tells us when to auto-expand).
export function isSectionActive(pathname: string, section: NavSection): boolean {
  if (pathname === section.href) return true;
  if (section.subs?.some((s) => pathname === s.href || pathname.startsWith(s.href + '/'))) return true;
  // Allow parent prefix matches except for the bare home "/".
  if (section.href !== '/' && pathname.startsWith(section.href + '/')) return true;
  return false;
}

export function isSubActive(pathname: string, sub: NavSub): boolean {
  return pathname === sub.href || pathname.startsWith(sub.href + '/');
}
