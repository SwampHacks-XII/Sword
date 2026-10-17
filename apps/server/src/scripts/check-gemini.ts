import 'dotenv/config';
import { readConfig } from '../config.js';
import { createGeminiGenerator, GeminiError } from '../story/gemini.js';

try {
  const config = readConfig();
  if (!config.gemini) throw new Error('Set GEMINI_ENABLED=true and GOOGLE_CLOUD_PROJECT in apps/server/.env first.');
  const generate = createGeminiGenerator(config.gemini);
  const start = performance.now();
  const story = await generate({ roundNumber: 1, previousBriefings: [] }, new AbortController().signal);
  console.log(`Gemini connected: ${config.gemini.model}, ${Math.round(performance.now() - start)} ms, ${story.briefing.split(/\s+/).length} words.`);
  console.log(`${story.title}\nMoss: ${story.briefing}`);
} catch (error) {
  console.error(error instanceof GeminiError ? error.message : 'Check Gemini configuration and local ADC setup.');
  process.exitCode = 1;
}
