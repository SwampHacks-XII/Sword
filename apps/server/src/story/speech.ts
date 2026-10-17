import { createHash } from 'node:crypto';
import { ApiError } from '../game/errors.js';

export interface ElevenLabsConfig { apiKey: string; voiceId: string; model: string; dailyCharacters: number }
export type SpeechService = ReturnType<typeof createSpeechService>;

/** Shared cache deduplicates both players' identical lines. Keys and provider errors never reach clients. */
export function createSpeechService(config: ElevenLabsConfig | null, deps: { fetch?: typeof fetch; now?: () => number; timeoutMs?: number } = {}) {
  const cache = new Map<string, { audio: Buffer; expires: number }>();
  const pending = new Map<string, Promise<Buffer>>();
  const rates = new Map<string, { start: number; count: number }>();
  const now = deps.now ?? Date.now;
  let day = ''; let characters = 0; let bytes = 0;
  return {
    enabled: Boolean(config),
    async synthesize(subject: string, rawText: string): Promise<Buffer> {
      if (!config) throw new ApiError(503, 'voice_disabled', 'ElevenLabs is not configured. Use the browser voice.');
      const text = rawText.trim().replace(/\s+/g, ' ');
      if (!text || text.length > 800) throw new ApiError(400, 'invalid_voice_text', 'Send 1–800 characters of Moss’s dialogue.');
      const time = now();
      for (const [key, value] of cache) if (value.expires < time) { bytes -= value.audio.length; cache.delete(key); }
      for (const [key, value] of rates) if (time - value.start >= 60_000) rates.delete(key);
      const key = createHash('sha256').update(text).digest('hex');
      const cached = cache.get(key);
      if (cached) return cached.audio;
      let rate = rates.get(subject);
      if (!rate) {
        if (rates.size >= 1000) throw new ApiError(429, 'voice_busy', 'Use the browser voice for now.');
        rate = { start: time, count: 0 }; rates.set(subject, rate);
      }
      if (++rate.count > 30) throw new ApiError(429, 'voice_rate_limit', 'Use the browser voice for now.');
      const existing = pending.get(key);
      if (existing) return existing;
      const today = new Date(time).toISOString().slice(0, 10);
      if (day !== today) { day = today; characters = 0; }
      if (pending.size >= 3 || characters + text.length > config.dailyCharacters) {
        throw new ApiError(429, 'voice_budget', 'The voice usage limit was reached. Use the browser voice.');
      }
      characters += text.length;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 6000);
      const task = Promise.resolve().then(async () => {
        try {
          const response = await (deps.fetch ?? fetch)(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(config.voiceId)}?output_format=mp3_44100_128`, {
            method: 'POST', headers: { 'xi-api-key': config.apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
            signal: controller.signal,
            body: JSON.stringify({ text, model_id: config.model, language_code: 'en',
              voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0, use_speaker_boost: false, speed: 1.03 } }),
          });
          if (!response.ok) {
            const detail = await response.json().catch(() => null) as { detail?: { status?: string } } | null;
            const message = detail?.detail?.status === 'api_key_id_used_as_api_key'
              ? 'ELEVENLABS_API_KEY contains a key ID. Replace it with the secret API key shown when you create the key.'
              : response.status === 401 ? 'ElevenLabs rejected the API key. Check its Text to Speech permission.'
              : response.status === 403 ? 'ElevenLabs denied access. Check voice access and the key’s permissions.'
              : response.status === 404 ? 'ElevenLabs could not find that Voice ID in your account.'
              : response.status === 429 ? 'ElevenLabs has reached a quota or rate limit.'
              : 'ElevenLabs could not provide audio. Use the browser voice.';
            throw new ApiError(503, 'voice_unavailable', message);
          }
          if (!response.headers.get('content-type')?.startsWith('audio/')) {
            await response.body?.cancel(); throw new Error('Invalid audio type');
          }
          const audio = Buffer.from(await response.arrayBuffer());
          if (!audio.length || audio.length > 2 * 1024 * 1024) throw new Error('Invalid audio');
          while (cache.size >= 100 || bytes + audio.length > 8 * 1024 * 1024) {
            const oldest = cache.keys().next().value;
            if (!oldest) break;
            bytes -= cache.get(oldest)!.audio.length; cache.delete(oldest);
          }
          cache.set(key, { audio, expires: now() + 60 * 60_000 }); bytes += audio.length;
          return audio;
        } catch (error) {
          if (error instanceof ApiError) throw error;
          throw new ApiError(503, 'voice_unavailable', 'ElevenLabs could not provide audio. Use the browser voice.');
        } finally { clearTimeout(timer); pending.delete(key); }
      });
      pending.set(key, task);
      return task;
    },
  };
}
