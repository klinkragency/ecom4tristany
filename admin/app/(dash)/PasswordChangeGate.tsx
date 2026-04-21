'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api';

// Mounted once in the dash layout. Fetches /me on route change and forces
// a redirect to /settings/change-password when the admin still has the
// invite-issued temporary password (`mustChangePassword=true` on the
// admin_users row). Once they update, the flag clears and this is a
// cheap no-op on subsequent navigations.
export default function PasswordChangeGate() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Don't loop on the change-password page itself.
    if (pathname === '/settings/change-password') return;
    (async () => {
      try {
        const me = await api<{ mustChangePassword?: boolean }>('/api/admin/me');
        if (me.mustChangePassword) {
          router.replace('/settings/change-password');
        }
      } catch {
        // 401 etc. — the existing middleware already handles auth redirects.
      }
    })();
  }, [pathname, router]);

  return null;
}
