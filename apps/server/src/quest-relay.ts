import { createQuestRelayApp, readQuestRelayConfig } from './story/quest-relay.js';
import { createGeminiGenerator } from './story/gemini.js';

try {
  const config = readQuestRelayConfig();
  // Leave time for the response to travel back inside Render's four-second deadline.
  const generate = createGeminiGenerator(config.gemini, { timeoutMs: 3500 });
  const server = createQuestRelayApp(config.token, generate).listen(config.port, '0.0.0.0', () => {
    console.log(`Moss quest helper listening on port ${config.port}; using attached Google service identity.`);
  });
  server.on('error', () => { console.error('The quest helper could not listen on PORT.'); process.exitCode = 1; });
  const shutdown = () => { server.close(); server.closeIdleConnections(); };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Check the quest helper configuration.');
  process.exitCode = 1;
}
