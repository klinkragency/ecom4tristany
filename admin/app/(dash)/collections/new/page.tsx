'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import type { Collection } from '@/lib/types';
import RichTextEditor from '@/components/RichTextEditor';

export default function NewCollectionPage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<'manual' | 'rules'>('manual');
  const [matchAll, setMatchAll] = useState(true);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const body = {
        title,
        descriptionHtml: description,
        isRulesBased: kind === 'rules',
        matchAll,
        sortOrder: kind === 'manual' ? 'manual' : 'created_desc',
      };
      const c = await api<Collection>('/api/admin/collections', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      router.push(`/collections/${c.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Create failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="max-w-2xl">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/collections" className="text-sm text-[color:var(--color-text-muted)] hover:underline">
          ← Collections
        </Link>
        <h1 className="text-2xl font-semibold">New collection</h1>
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">
          {error}
        </div>
      )}

      <form onSubmit={submit} className="space-y-4">
        <div className="rounded border border-[color:var(--color-border)] bg-white p-4 space-y-3">
          <label className="block">
            <div className="text-sm font-medium mb-1">Title</div>
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 rounded border border-[color:var(--color-border)]"
            />
          </label>
          <label className="block">
            <div className="text-sm font-medium mb-1">Description</div>
            <RichTextEditor
              value={description}
              onChange={setDescription}
              placeholder="Describe the collection…"
              minHeight={140}
            />
          </label>
        </div>

        <div className="rounded border border-[color:var(--color-border)] bg-white p-4 space-y-3">
          <div className="text-sm font-semibold">Collection type</div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="kind"
              checked={kind === 'manual'}
              onChange={() => setKind('manual')}
              className="mt-1"
            />
            <div>
              <div className="font-medium">Manual</div>
              <div className="text-xs text-[color:var(--color-text-muted)]">
                Pick products one by one. Order can be rearranged.
              </div>
            </div>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="kind"
              checked={kind === 'rules'}
              onChange={() => setKind('rules')}
              className="mt-1"
            />
            <div>
              <div className="font-medium">Rule-based (smart)</div>
              <div className="text-xs text-[color:var(--color-text-muted)]">
                Products auto-match conditions (price, tag, status, …). Updates as the catalog changes.
              </div>
            </div>
          </label>

          {kind === 'rules' && (
            <div className="pl-6 text-sm">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={matchAll}
                  onChange={(e) => setMatchAll(e.target.checked)}
                />
                Match <strong>all</strong> rules (unchecked = match any)
              </label>
            </div>
          )}
        </div>

        <div className="flex gap-2 justify-end">
          <Link
            href="/collections"
            className="px-3 py-2 text-sm rounded border border-[color:var(--color-border)]"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={pending}
            className="px-3 py-2 text-sm rounded bg-[color:var(--color-accent)] text-white hover:bg-[color:var(--color-accent-hover)] disabled:opacity-50"
          >
            {pending ? 'Creating…' : 'Create collection'}
          </button>
        </div>
      </form>
    </section>
  );
}
