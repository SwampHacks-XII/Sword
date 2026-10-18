import { randomUUID } from 'node:crypto';
import { GoogleAuth } from 'google-auth-library';
import { isQuestStory, type QuestGenerator } from '@sword/protocol';

export interface GeminiConfig {
  project: string; location: string; model: string; dailyLimit: number;
  relay?: { url: string; token: string };
}
export class GeminiError extends Error {
  constructor(public readonly reason: 'credentials' | 'permission' | 'model' | 'quota' | 'timeout' | 'response' | 'unavailable' | 'limit') {
    const messages = {
      credentials: 'Google credentials are unavailable. Check local ADC or the Cloud Run service account attached to the quest helper.',
      permission: 'Google denied access. Check the project, enabled Agent Platform API, and the ADC account’s Agent Platform User role (roles/aiplatform.user).',
      model: 'The configured Gemini model is unavailable in this project/location.',
      quota: 'Google’s Gemini quota is currently exhausted. The game will use a local story.',
      timeout: 'Gemini did not respond within four seconds. The game will use a local story.',
      response: 'Gemini returned an incomplete or invalid short story. The game will use a local story.',
      unavailable: 'Gemini could not be reached. The game will use a local story.',
      limit: 'The local daily Gemini request limit or concurrency limit was reached. The game will use a local story.',
    };
    super(messages[reason]);
  }
}
interface Dependencies { headers?: () => Promise<Headers>; fetch?: typeof fetch; timeoutMs?: number; now?: () => number }

/** ADC is server-only. Never include raw provider errors: they can contain credential headers. */
export function createGeminiGenerator(config: GeminiConfig, deps: Dependencies = {}): QuestGenerator {
  if (config.relay) return createRelayGenerator(config, deps);
  const auth = new GoogleAuth({ projectId: config.project, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const host = config.location === 'global' ? 'aiplatform.googleapis.com' : `${config.location}-aiplatform.googleapis.com`;
  const endpoint = `https://${host}/v1/projects/${encodeURIComponent(config.project)}/locations/${encodeURIComponent(config.location)}/publishers/google/models/${encodeURIComponent(config.model)}:generateContent`;
  const headers = deps.headers ?? (() => auth.getRequestHeaders(endpoint));
  const request = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  let day = ''; let requests = 0; let active = 0;
  return async (context, signal) => {
    const today = new Date(now()).toISOString().slice(0, 10);
    if (today !== day) { day = today; requests = 0; }
    if (signal.aborted) throw new GeminiError('timeout');
    if (requests >= config.dailyLimit || active >= 3) throw new GeminiError('limit');
    requests++; active++;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const operation = (async () => {
        let authorization: Headers;
        try { authorization = new Headers(await headers()); }
        catch { throw new GeminiError('credentials'); }
        controller.signal.throwIfAborted();
        authorization.set('Content-Type', 'application/json');
        const response = await request(endpoint, {
          method: 'POST', headers: authorization, signal: controller.signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: 'You are Moss, a kind, witty forest NPC in a pastel magic-sword game. Write a fresh, family-friendly quest about the hero’s mischievous evil twin. Address the hero as “you”. Describe a concrete silly problem and ask the hero to stop the twin. Use 1–2 sentences, 15–35 words, strictly fewer than 50 words. No violence, romance, real people, player names, markdown, dialogue tags, or game mechanics. Return only JSON with a short title (up to 6 words) and briefing.' }] },
            contents: [{ role: 'user', parts: [{ text: JSON.stringify({ round: context.roundNumber, variation: randomUUID(),
              avoidRepeating: context.previousBriefings.slice(-8) }) }] }],
            generationConfig: { maxOutputTokens: 256, thinkingConfig: { thinkingLevel: 'MINIMAL' },
              responseMimeType: 'application/json', responseSchema: { type: 'OBJECT',
                properties: { title: { type: 'STRING' }, briefing: { type: 'STRING' } }, required: ['title', 'briefing'] } },
          }),
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new GeminiError(response.status === 401 ? 'credentials' : response.status === 403 ? 'permission'
            : response.status === 404 ? 'model' : response.status === 429 ? 'quota' : 'unavailable');
        }
        const body = await response.json() as { candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
        const candidate = body.candidates?.[0];
        const text = candidate?.content?.parts?.filter(part => !part.thought).map(part => part.text ?? '').join('');
        if (candidate?.finishReason !== 'STOP' || !text || text.length > 2000) throw new GeminiError('response');
        let value: { title?: unknown; briefing?: unknown };
        try { value = JSON.parse(text); } catch { throw new GeminiError('response'); }
        const story = { title: typeof value?.title === 'string' ? value.title.trim().replace(/\s+/g, ' ') : '',
          briefing: typeof value?.briefing === 'string' ? value.briefing.trim().replace(/\s+/g, ' ') : '', source: 'gemini' as const };
        if (!isQuestStory(story) || story.title.split(/\s+/).length > 6) throw new GeminiError('response');
        return story;
      })();
      return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new GeminiError('timeout')); }, deps.timeoutMs ?? 4000);
        controller.signal.addEventListener('abort', () => reject(new GeminiError('timeout')), { once: true });
      })]);
    } catch (error) {
      throw error instanceof GeminiError ? error : new GeminiError(controller.signal.aborted ? 'timeout' : 'unavailable');
    } finally {
      if (timer) clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      active--;
    }
  };
}

/** Render calls our narrow quest endpoint; Google credentials never leave Cloud Run. */
function createRelayGenerator(config: GeminiConfig, deps: Dependencies): QuestGenerator {
  const relay = config.relay!;
  const request = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  let day = ''; let attempts = 0; let active = 0;
  return async (context, signal) => {
    if (signal.aborted) throw new GeminiError('timeout');
    const today = new Date(now()).toISOString().slice(0, 10);
    if (day !== today) { day = today; attempts = 0; }
    if (attempts >= config.dailyLimit || active >= 3) throw new GeminiError('limit');
    attempts++; active++;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const operation = (async () => {
        const response = await request(`${relay.url}/generate`, {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', 'X-Sword-Quest-Token': relay.token },
          body: JSON.stringify({ roundNumber: context.roundNumber, previousBriefings: context.previousBriefings.slice(-8) }),
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new GeminiError(response.status === 401 || response.status === 403 ? 'permission'
            : response.status === 429 ? 'limit' : 'unavailable');
        }
        const value: unknown = await response.json();
        if (!isQuestStory(value) || value.source !== 'gemini' || value.title.split(/\s+/).length > 6) throw new GeminiError('response');
        return { title: value.title, briefing: value.briefing, source: 'gemini' as const };
      })();
      return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new GeminiError('timeout')); }, deps.timeoutMs ?? 4000);
        controller.signal.addEventListener('abort', () => reject(new GeminiError('timeout')), { once: true });
      })]);
    } catch (error) {
      throw error instanceof GeminiError ? error : new GeminiError(controller.signal.aborted ? 'timeout' : 'unavailable');
    } finally {
      if (timer) clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      active--;
    }
  };
}
