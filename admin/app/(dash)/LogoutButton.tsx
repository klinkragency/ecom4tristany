'use client';

import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

export default function LogoutButton() {
  const router = useRouter();
  async function logout() {
    try {
      await api('/api/admin/auth/logout', { method: 'POST' });
    } finally {
      router.replace('/login');
      router.refresh();
    }
  }
  return (
    <button
      onClick={logout}
      className="text-sm text-[color:var(--color-text-muted)] hover:text-black"
    >
      Log out
    </button>
  );
}
