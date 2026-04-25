'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type Me = { id: string; email: string; name: string; role: 'owner' | 'admin' | 'staff' };

// Permission matrix displayed in the role modal. Must mirror the RBAC guards
// in backend/internal/server/router.go — if we change the route guards, we
// update this too so the UI stays honest.
const PERMS: Array<{ key: string; label: string; allowed: Me['role'][] }> = [
  { key: 'read',           label: 'View everything (products, orders, customers, analytics)', allowed: ['owner', 'admin', 'staff'] },
  { key: 'product_write',  label: 'Create and edit products',                                  allowed: ['owner', 'admin', 'staff'] },
  { key: 'order_write',    label: 'Update orders (notes, tags, fulfillments)',                 allowed: ['owner', 'admin', 'staff'] },
  { key: 'customer_write', label: 'Edit customers + issue store credit',                       allowed: ['owner', 'admin', 'staff'] },
  { key: 'content_write',  label: 'Manage pages, menus, blog, discounts',                      allowed: ['owner', 'admin'] },
  { key: 'product_delete', label: 'Delete products',                                           allowed: ['owner', 'admin'] },
  { key: 'refund',         label: 'Issue refunds',                                             allowed: ['owner', 'admin'] },
  { key: 'discount_write', label: 'Create / edit / delete discounts',                          allowed: ['owner', 'admin'] },
  { key: 'admin_users',    label: 'Invite / remove admin users, change roles',                 allowed: ['owner'] },
  { key: 'settings',       label: 'Edit shop settings',                                        allowed: ['owner'] },
  { key: 'audit',          label: 'Read the audit log',                                        allowed: ['owner'] },
];

const ROLE_BADGE: Record<Me['role'], string> = {
  owner: 'bg-purple-100 text-purple-800',
  admin: 'bg-blue-100 text-blue-800',
  staff: 'bg-gray-100 text-gray-800',
};

export default function WhoAmI() {
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try { setMe(await api<Me>('/api/admin/me')); } catch { /* not signed in */ }
    })();
  }, []);

  if (!me) return null;

  const initials = (me.name || me.email).split(/\s+/).map((s) => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-2 px-2 py-2 rounded border border-stone-200 hover:bg-gray-50 text-left"
        title="View my role + permissions"
      >
        <div className="w-8 h-8 shrink-0 rounded-full bg-gray-900 text-white grid place-items-center text-xs font-semibold">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium truncate">{me.name || me.email}</div>
          <div className="flex items-center gap-1 mt-0.5">
            <span className={`text-[10px] rounded px-1.5 py-0.5 ${ROLE_BADGE[me.role]}`}>
              {me.role}
            </span>
            <span className="text-[10px] text-stone-500 truncate">{me.email}</span>
          </div>
        </div>
      </button>

      {open && <RoleModal me={me} onClose={() => setOpen(false)} />}
    </>
  );
}

function RoleModal({ me, onClose }: { me: Me; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg bg-white shadow-xl p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="font-semibold">{me.name || me.email}</h2>
            <span className={`text-xs rounded px-2 py-0.5 ${ROLE_BADGE[me.role]}`}>{me.role}</span>
          </div>
          <div className="text-xs text-stone-500">{me.email}</div>
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500 mb-2">
            What your role can do
          </h3>
          <ul className="space-y-1.5 text-sm">
            {PERMS.map((p) => {
              const allowed = p.allowed.includes(me.role);
              return (
                <li key={p.key} className="flex items-start gap-2">
                  <span className={`shrink-0 w-4 text-center ${allowed ? 'text-green-700' : 'text-gray-400'}`}>
                    {allowed ? '✓' : '—'}
                  </span>
                  <span className={allowed ? '' : 'text-stone-500'}>
                    {p.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="pt-2 flex justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded border border-stone-200 hover:bg-gray-50">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
