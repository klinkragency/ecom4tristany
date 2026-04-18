const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

type ApiOptions = RequestInit & { csrfToken?: string | null };

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp('(^|;\\s*)' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]!) : null;
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { csrfToken, headers, ...rest } = opts;
  const method = (rest.method ?? 'GET').toUpperCase();
  const mutating = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';

  let token = csrfToken;
  if (mutating && token === undefined) {
    token = getCookie('csrf_token');
    if (!token) {
      const res = await fetch(`${API}/api/csrf`, { credentials: 'include' });
      const json = (await res.json()) as { csrfToken: string };
      token = json.csrfToken;
    }
  }

  const h = new Headers(headers);
  h.set('Content-Type', 'application/json');
  if (mutating && token) h.set('X-CSRF-Token', token);

  const res = await fetch(`${API}${path}`, {
    ...rest,
    method,
    headers: h,
    credentials: 'include',
  });

  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body as { error?: string }).error ?? `HTTP ${res.status}`;
    throw new ApiError(msg, res.status);
  }
  return body as T;
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}
