'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Store,
  Coins,
  Receipt,
  Truck,
  MapPin,
  Users,
  KeyRound,
  ScrollText,
  type LucideIcon,
} from 'lucide-react';

type Item = { href: string; label: string; icon: LucideIcon; description?: string };
type Group = { label: string; items: Item[] };

const GROUPS: Group[] = [
  {
    label: 'Store',
    items: [
      { href: '/settings/general', label: 'General', icon: Store, description: 'Name, URL, base currency' },
    ],
  },
  {
    label: 'Markets & money',
    items: [
      { href: '/settings/currencies', label: 'Currencies', icon: Coins, description: 'Active + exchange rates' },
      { href: '/settings/taxes', label: 'Taxes', icon: Receipt, description: 'VAT per country' },
      { href: '/settings/shipping', label: 'Shipping', icon: Truck, description: 'Zones and rates' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/settings/locations', label: 'Locations', icon: MapPin, description: 'Warehouses, retail' },
    ],
  },
  {
    label: 'People',
    items: [
      { href: '/settings/users', label: 'Users and permissions', icon: Users, description: 'Invite teammates' },
      { href: '/settings/change-password', label: 'Change password', icon: KeyRound },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/settings/audit', label: 'Audit log', icon: ScrollText, description: 'Every admin action' },
    ],
  },
];

export default function SettingsRail() {
  const pathname = usePathname();

  return (
    <nav className="space-y-5 overflow-y-auto p-4">
      {GROUPS.map((g) => (
        <div key={g.label}>
          <div className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-stone-400">
            {g.label}
          </div>
          <div className="space-y-0.5">
            {g.items.map((it) => {
              const Icon = it.icon;
              const active = pathname === it.href || pathname.startsWith(it.href + '/');
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  replace
                  className={`group flex items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors ${
                    active ? 'bg-stone-900 text-white' : 'text-stone-700 hover:bg-stone-100'
                  }`}
                >
                  <Icon
                    className={`mt-[2px] h-4 w-4 shrink-0 transition-transform group-hover:scale-110 ${
                      active ? 'text-white' : 'text-stone-500'
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm leading-tight">{it.label}</span>
                    {it.description && (
                      <span
                        className={`block truncate text-[11px] leading-tight ${
                          active ? 'text-stone-300' : 'text-stone-500'
                        }`}
                      >
                        {it.description}
                      </span>
                    )}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
