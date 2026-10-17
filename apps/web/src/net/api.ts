export interface ApiMatch {
  id: string; joinCode: string; status: 'waiting' | 'active' | 'completed';
}
export interface Profile { id: string; displayName: string }
export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'ApiRequestError'; }
}
export function resolveApiBaseUrl(value?: string, origin?: string) {
  if (value === 'same-origin') {
    if (!origin) throw new Error('The hosted API needs the website origin.');
    return origin;
  }
  return (value || 'http://localhost:3001').replace(/\/$/, '');
}
export const apiBaseUrl = resolveApiBaseUrl(import.meta.env?.VITE_API_BASE_URL,
  typeof window === 'undefined' ? undefined : window.location.origin);

export function createApi(getToken: () => Promise<string>) {
  return {
    async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
      let token: string;
      try { token = await getToken(); }
      catch { throw new Error('Please sign in again to play online.'); }
      let response: Response;
      try {
        response = await fetch(`${apiBaseUrl}/api${path}`, {
          method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch { throw new Error('Cannot reach the game server. Check that the backend is running.'); }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401) throw new ApiRequestError('Your login expired. Sign out and sign in again.', response.status);
        throw new ApiRequestError(typeof data.message === 'string' ? data.message : 'The server could not complete that action.', response.status);
      }
      return data as T;
    },
  };
}
export type Api = ReturnType<typeof createApi>;
