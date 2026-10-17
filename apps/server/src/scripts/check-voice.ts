import 'dotenv/config';
import { readConfig } from '../config.js';
import { createSpeechService } from '../story/speech.js';
import { ApiError } from '../game/errors.js';

try {
  const config = readConfig();
  if (!config.elevenlabs) throw new Error('Set ELEVENLABS_ENABLED=true, ELEVENLABS_API_KEY, and ELEVENLABS_VOICE_ID in apps/server/.env first.');
  const start = performance.now();
  const audio = await createSpeechService(config.elevenlabs).synthesize('local-voice-check', 'Hello, brave adventurer! I’m Moss, your little guide to the glade.');
  console.log(`ElevenLabs connected: ${audio.length} bytes of MP3 audio in ${Math.round(performance.now() - start)} ms.`);
  console.log('Open the game’s story pages to hear Moss automatically, including before login.');
} catch (error) {
  console.error(error instanceof ApiError ? error.message : 'Configure ElevenLabs in the private backend .env before checking its connection.');
  process.exitCode = 1;
}
