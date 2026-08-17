const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:9999';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string | null;
}

/** Thin fetch wrapper — JSON in/out, unified error shape, optional bearer token. */
export async function api<T>(path: string, { method = 'GET', body, token }: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach Picly servers. Check your connection.', 0);
  }

  const data = (await res.json().catch(() => null)) as
    | { error?: string; message?: string; [k: string]: unknown }
    | null;

  if (!res.ok) {
    throw new ApiError(data?.message ?? `Request failed (${res.status})`, res.status, data?.error);
  }
  return data as T;
}

export function getApiUrl(): string {
  return API_URL;
}
