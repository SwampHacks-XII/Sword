import { apiBaseUrl } from './api';
import { isPublicMossLine } from '@sword/protocol';

// Audio only stays in memory. Refresh the page after changing the backend voice.
const cache = new Map<string, Blob>();
let bytes = 0;
export async function loadMossAudio(text: string, getToken: () => Promise<string>, signal: AbortSignal): Promise<Blob> {
  const key = text.trim().replace(/\s+/g, ' ');
  const cached = cache.get(key);
  if (cached) return cached;
  const builtIn = isPublicMossLine(key);
  const token = builtIn ? null : await getToken();
  signal.throwIfAborted();
  const response = await fetch(`${apiBaseUrl}/${builtIn ? '' : 'api/'}voice/speak`, {
    method: 'POST', signal, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: key }),
  });
  if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/')) throw new Error('Use the browser voice');
  const blob = await response.blob();
  if (!blob.size || blob.size > 2 * 1024 * 1024) throw new Error('Invalid voice audio');
  while (cache.size >= 50 || bytes + blob.size > 8 * 1024 * 1024) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    bytes -= cache.get(oldest)!.size; cache.delete(oldest);
  }
  cache.set(key, blob); bytes += blob.size;
  return blob;
}
