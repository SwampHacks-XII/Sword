import { recognitionMessage, type RecognitionFactory, type CommandRecognition } from './commandRecognition';

export type MossListeningMode = 'off' | 'wake' | 'command';
const wakePhrase = /^\s*hey[\s,]+moss\b[\s,.!?;:]*/i;

/** A single browser session watches for the wake phrase, then accepts one final command. */
export function createHandsFreeListener(factory: RecognitionFactory, callbacks: {
  mode(value: MossListeningMode): void;
  started(): void;
  wake(): void;
  preview(text: string): void;
  transcript(text: string): void;
  error(message: string, recoverable: boolean): void;
}, options: { commandTimeoutMs?: number; restartMs?: number } = {}) {
  let mode: MossListeningMode = 'off';
  let active: CommandRecognition | null = null;
  let generation = 0;
  let restart: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let startup: ReturnType<typeof setTimeout> | undefined;
  let quickEnds = 0;
  let preview = '';

  function release() {
    const previous = active; active = null;
    clearTimeout(startup);
    if (!previous) return;
    previous.onstart = previous.onnomatch = previous.onresult = previous.onerror = previous.onend = null;
    try { previous.abort(); } catch { /* The browser already ended this session. */ }
  }
  function stop() {
    generation++;
    clearTimeout(restart); clearTimeout(deadline);
    release();
    if (mode !== 'off') { mode = 'off'; callbacks.mode(mode); }
  }
  function fail(code: string) {
    stop();
    callbacks.error(recognitionMessage(code), ['no-speech', 'unfinished', 'nomatch'].includes(code));
  }
  function commandWindow() {
    clearTimeout(deadline);
    deadline = setTimeout(() => fail(preview ? 'unfinished' : 'no-speech'), options.commandTimeoutMs ?? 10000);
  }
  function connect(current: number) {
    if (current !== generation || mode === 'off') return;
    try {
      const recognizer = factory(); active = recognizer;
      let openedAt = Date.now();
      let wakeResult: number | null = null;
      const valid = () => current === generation && active === recognizer;
      recognizer.lang = 'en-US';
      recognizer.continuous = true;
      recognizer.interimResults = true;
      recognizer.maxAlternatives = 1;
      recognizer.onstart = () => {
        if (!valid()) return;
        clearTimeout(startup); openedAt = Date.now(); callbacks.started();
      };
      const reconnect = () => {
        if (!valid()) return;
        if (mode === 'command' && preview) { fail('unfinished'); return; }
        quickEnds = Date.now() - openedAt < 1000 ? quickEnds + 1 : 0;
        release();
        if (quickEnds >= 3) { fail('not-started'); return; }
        restart = setTimeout(() => connect(current), options.restartMs ?? 500);
      };
      recognizer.onend = reconnect;
      recognizer.onnomatch = () => { if (valid() && mode === 'command') fail('nomatch'); };
      recognizer.onerror = event => {
        if (!valid()) return;
        if (event.error === 'no-speech' && mode === 'wake') reconnect();
        else fail(event.error);
      };
      recognizer.onresult = event => {
        if (!valid()) return;
        for (let index = event.resultIndex; index < event.results.length; index++) {
          const result = event.results[index];
          if (!result) continue;
          const text = result[0]?.transcript.trim() ?? '';
          if (mode === 'wake') {
            if (!wakePhrase.test(text)) continue;
            mode = 'command'; wakeResult = index; preview = '';
            commandWindow(); callbacks.mode(mode); callbacks.wake();
            if (!valid()) return;
          }
          // Interim updates to the wake result must keep the prefix; the following
          // result can contain only the command ("Hey Moss" → pause → "start my quest").
          if (wakeResult === index && !wakePhrase.test(text)) continue;
          const command = text.replace(wakePhrase, '').trim();
          if (!command) continue;
          preview = command.slice(0, 201);
          callbacks.preview(preview);
          if (!result.isFinal) continue;
          const transcript = preview;
          stop(); // Release the microphone before the existing command handler replies.
          callbacks.transcript(transcript);
          return;
        }
      };
      startup = setTimeout(() => { if (valid()) fail('not-started'); }, 8000);
      recognizer.start();
    } catch (error) { fail(error instanceof Error ? error.name : 'unknown'); }
  }
  return {
    stop,
    start(next: 'wake' | 'command') {
      if (mode !== 'off') return;
      mode = next; preview = ''; quickEnds = 0;
      const current = ++generation;
      callbacks.mode(mode);
      if (next === 'command') commandWindow();
      connect(current);
    },
  };
}
