import { z } from 'zod';
import type { GeminiConfig } from './story/gemini.js';
import type { ElevenLabsConfig } from './story/speech.js';

export interface Config {
  host: string;
  port: number;
  webOrigin: string;
  auth0: { issuerBaseURL: string; audience: string } | null;
  databaseUrl: string | null;
  serveWeb?: boolean;
  gemini?: GeminiConfig | null;
  elevenlabs?: ElevenLabsConfig | null;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const serveWeb = env.SERVE_WEB === 'true';
  const publicUrl = env.PUBLIC_APP_URL?.trim() || env.RENDER_EXTERNAL_URL?.trim();
  if (serveWeb && !publicUrl) throw new Error('Set PUBLIC_APP_URL for the hosted website (Render supplies RENDER_EXTERNAL_URL automatically).');
  const schema = z.object({
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    WEB_ORIGIN: z.url().default('http://localhost:5173'),
  });
  const parsed = schema.safeParse({ ...env, WEB_ORIGIN: serveWeb ? publicUrl : env.WEB_ORIGIN });
  if (!parsed.success) throw new Error('Check HOST, PORT, and WEB_ORIGIN in apps/server/.env.');
  const webUrl = new URL(parsed.data.WEB_ORIGIN);
  if (!['https:', 'http:'].includes(webUrl.protocol) || webUrl.username || webUrl.password
    || (serveWeb && (webUrl.pathname !== '/' || webUrl.search || webUrl.hash
      || (webUrl.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(webUrl.hostname))))) {
    throw new Error('Use the HTTPS website origin for PUBLIC_APP_URL. Local previews may use http://localhost.');
  }
  const issuer = env.AUTH0_ISSUER_BASE_URL?.trim() || '';
  const audience = env.AUTH0_AUDIENCE?.trim() || '';
  if (Boolean(issuer) !== Boolean(audience)) {
    throw new Error('Set both AUTH0_ISSUER_BASE_URL and AUTH0_AUDIENCE, or leave both blank.');
  }
  if (issuer) {
    let url: URL;
    try { url = new URL(issuer); }
    catch { throw new Error('AUTH0_ISSUER_BASE_URL must be your HTTPS Auth0 tenant URL.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('AUTH0_ISSUER_BASE_URL must be your HTTPS Auth0 tenant URL, without extra paths.');
    }
  }
  const databaseUrl = env.DATABASE_URL?.trim() || null;
  if (databaseUrl) {
    let url: URL;
    try { url = new URL(databaseUrl); }
    catch { throw new Error('DATABASE_URL must be a PostgreSQL connection string.'); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
      throw new Error('DATABASE_URL must be a PostgreSQL connection string.');
    }
  }
  if (env.NODE_ENV === 'production' && (!issuer || !databaseUrl)) {
    throw new Error('Production requires Auth0 and DATABASE_URL configuration.');
  }
  let gemini: GeminiConfig | null = null;
  if (env.GEMINI_ENABLED === 'true') {
    const settings = z.object({ project: z.string().regex(/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/),
      location: z.string().regex(/^(global|[a-z]+-[a-z]+[0-9])$/), model: z.string().regex(/^gemini-[a-z0-9.-]+$/),
      dailyLimit: z.coerce.number().int().min(1).max(10000) }).safeParse({
      project: env.GOOGLE_CLOUD_PROJECT?.trim(), location: env.GOOGLE_CLOUD_LOCATION?.trim() || 'global',
      model: env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite', dailyLimit: env.GEMINI_DAILY_REQUEST_LIMIT || 500,
    });
    if (!settings.success) throw new Error('Check GOOGLE_CLOUD_PROJECT, GOOGLE_CLOUD_LOCATION, GEMINI_MODEL, and GEMINI_DAILY_REQUEST_LIMIT.');
    gemini = settings.data;
  }
  let elevenlabs: ElevenLabsConfig | null = null;
  if (env.ELEVENLABS_ENABLED === 'true') {
    const voice = z.object({ apiKey: z.string().min(10).max(512).regex(/^[^\s]+$/),
      voiceId: z.string().regex(/^[a-zA-Z0-9_-]{10,128}$/),
      model: z.enum(['eleven_flash_v2_5', 'eleven_multilingual_v2']),
      dailyCharacters: z.coerce.number().int().min(1).max(1000000) }).safeParse({
      apiKey: env.ELEVENLABS_API_KEY?.trim(), voiceId: env.ELEVENLABS_VOICE_ID?.trim(),
      model: env.ELEVENLABS_MODEL?.trim() || 'eleven_flash_v2_5', dailyCharacters: env.ELEVENLABS_DAILY_CHARACTER_LIMIT || 10000,
    });
    if (!voice.success) throw new Error('Check ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, ELEVENLABS_MODEL and ELEVENLABS_DAILY_CHARACTER_LIMIT in the backend environment.');
    elevenlabs = voice.data;
  }
  return {
    host: parsed.data.HOST,
    port: parsed.data.PORT,
    webOrigin: new URL(parsed.data.WEB_ORIGIN).origin,
    auth0: issuer ? { issuerBaseURL: issuer, audience } : null,
    databaseUrl,
    serveWeb,
    gemini,
    elevenlabs,
  };
}
