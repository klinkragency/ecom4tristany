'use client';

import { useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { Product, ProductMedia } from '@/lib/types';

type PresignResp = {
  uploadUrl: string;
  objectKey: string;
  publicUrl: string;
  expiresInSeconds: number;
};

type UploadingFile = { name: string; status: 'uploading' | 'error'; error?: string };

export default function MediaUploader({
  product,
  onChanged,
}: {
  product: Product;
  onChanged: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<UploadingFile[]>([]);
  const [dragOver, setDragOver] = useState(false);

  async function readImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        resolve(null);
        URL.revokeObjectURL(url);
      };
      img.src = url;
    });
  }

  async function uploadOne(file: File) {
    setUploading((s) => [...s, { name: file.name, status: 'uploading' }]);
    const markError = (msg: string) =>
      setUploading((s) =>
        s.map((u) => (u.name === file.name ? { ...u, status: 'error', error: msg } : u)),
      );

    try {
      const presign = await api<PresignResp>(
        `/api/admin/products/${product.id}/media/presign`,
        {
          method: 'POST',
          body: JSON.stringify({ filename: file.name, contentType: file.type }),
        },
      );

      const putRes = await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!putRes.ok) {
        throw new Error(`Upload failed (${putRes.status})`);
      }

      const dims = await readImageDimensions(file);

      await api<ProductMedia>(`/api/admin/products/${product.id}/media`, {
        method: 'POST',
        body: JSON.stringify({
          objectKey: presign.objectKey,
          alt: '',
          mime: file.type,
          bytes: file.size,
          width: dims?.width,
          height: dims?.height,
        }),
      });

      setUploading((s) => s.filter((u) => u.name !== file.name));
      onChanged();
    } catch (err) {
      markError(err instanceof Error ? err.message : 'Upload failed');
    }
  }

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) continue;
      // Fire-and-forget in parallel (a few images is fine).
      void uploadOne(f);
    }
  }

  async function remove(mediaId: string) {
    if (!confirm('Delete this image?')) return;
    try {
      await api(`/api/admin/media/${mediaId}`, { method: 'DELETE' });
      onChanged();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  async function move(mediaId: string, direction: -1 | 1) {
    const ordered = [...product.media]
      .sort((a, b) => a.position - b.position)
      .map((m) => m.id);
    const idx = ordered.indexOf(mediaId);
    const next = idx + direction;
    if (idx < 0 || next < 0 || next >= ordered.length) return;
    [ordered[idx], ordered[next]] = [ordered[next]!, ordered[idx]!];
    try {
      await api(`/api/admin/products/${product.id}/media/reorder`, {
        method: 'POST',
        body: JSON.stringify({ orderedIds: ordered }),
      });
      onChanged();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Reorder failed');
    }
  }

  async function updateAlt(mediaId: string, alt: string) {
    try {
      await api(`/api/admin/media/${mediaId}`, {
        method: 'PUT',
        body: JSON.stringify({ alt }),
      });
      onChanged();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Save alt failed');
    }
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        void onFiles(e.dataTransfer.files);
      }}
      className={`rounded border-2 border-dashed p-4 transition-colors ${
        dragOver ? 'border-[color:var(--color-accent)] bg-gray-50' : 'border-[color:var(--color-border)]'
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm text-[color:var(--color-text-muted)]">
          Drag & drop images here, or click to pick files (PNG, JPG, WebP, GIF, AVIF).
        </div>
        <button
          onClick={() => inputRef.current?.click()}
          className="px-3 py-1.5 text-sm rounded border border-[color:var(--color-border)] hover:bg-gray-50"
        >
          Choose files…
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            void onFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {(product.media.length > 0 || uploading.length > 0) && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
          {product.media
            .slice()
            .sort((a, b) => a.position - b.position)
            .map((m, idx) => (
              <div key={m.id} className="border border-[color:var(--color-border)] rounded overflow-hidden bg-white">
                <div className="aspect-square bg-gray-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.url} alt={m.alt} className="w-full h-full object-cover" />
                </div>
                <div className="p-2 space-y-1">
                  <input
                    defaultValue={m.alt}
                    placeholder="Alt text"
                    onBlur={(e) => {
                      if (e.target.value !== m.alt) void updateAlt(m.id, e.target.value);
                    }}
                    className="w-full px-2 py-1 text-xs rounded border border-[color:var(--color-border)]"
                  />
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex gap-1">
                      <button
                        disabled={idx === 0}
                        onClick={() => move(m.id, -1)}
                        className="px-1.5 py-0.5 rounded border border-[color:var(--color-border)] disabled:opacity-30"
                        title="Move earlier"
                      >
                        ↑
                      </button>
                      <button
                        disabled={idx === product.media.length - 1}
                        onClick={() => move(m.id, 1)}
                        className="px-1.5 py-0.5 rounded border border-[color:var(--color-border)] disabled:opacity-30"
                        title="Move later"
                      >
                        ↓
                      </button>
                    </div>
                    <button
                      onClick={() => remove(m.id)}
                      className="text-red-700 hover:underline"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          {uploading.map((u) => (
            <div
              key={u.name}
              className="border border-[color:var(--color-border)] rounded bg-white p-2 text-xs"
            >
              <div className="aspect-square bg-gray-100 grid place-items-center mb-2">
                {u.status === 'uploading' ? (
                  <span className="text-[color:var(--color-text-muted)]">Uploading…</span>
                ) : (
                  <span className="text-red-700">Failed</span>
                )}
              </div>
              <div className="truncate" title={u.name}>{u.name}</div>
              {u.error && <div className="text-red-700 truncate">{u.error}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
