import { z } from 'zod';

export interface Config {
  host: string;
  port: number;
  webOrigin: string;
  auth0: { issuerBaseURL: string; audience: string } | null;
  databaseUrl: string | null;
  serveWeb?: boolean;
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
  return {
    host: parsed.data.HOST,
    port: parsed.data.PORT,
    webOrigin: new URL(parsed.data.WEB_ORIGIN).origin,
    auth0: issuer ? { issuerBaseURL: issuer, audience } : null,
    databaseUrl,
    serveWeb,
  };
}
