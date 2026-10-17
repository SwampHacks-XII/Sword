export interface ApiMatch {
  id: string; joinCode: string; status: 'waiting' | 'active' | 'completed';
}
export interface Profile { id: string; displayName: string }
export const apiBaseUrl = (import.meta.env?.VITE_API_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');

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
        if (response.status === 401) throw new Error('Your login expired. Sign out and sign in again.');
        throw new Error(typeof data.message === 'string' ? data.message : 'The server could not complete that action.');
      }
      return data as T;
    },
  };
}
export type Api = ReturnType<typeof createApi>;
