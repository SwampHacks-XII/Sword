interface RecognitionResult {
  isFinal: boolean;
  [index: number]: { transcript: string } | undefined;
}
export interface CommandRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}
export type RecognitionFactory = () => CommandRecognition;
export function browserCommandRecognition(): RecognitionFactory | null {
  const browser = window as unknown as {
    SpeechRecognition?: new () => CommandRecognition;
    webkitSpeechRecognition?: new () => CommandRecognition;
  };
  const Constructor = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
  return Constructor ? () => new Constructor() : null;
}

export function recognitionMessage(code: string) {
  if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'NotAllowedError') {
    return 'Microphone access wasn’t allowed. Use localhost or HTTPS, allow microphone access, and try again.';
  }
  if (code === 'audio-capture') return 'No microphone was found. Check that your microphone is connected.';
  if (code === 'network') return 'The browser’s speech service couldn’t connect. Try again or use the game buttons.';
  if (code === 'no-speech') return 'I didn’t hear a command. Click the microphone and try again.';
  return 'Voice input couldn’t start. Try again or use the game buttons.';
}

export function createCommandListener(factory: RecognitionFactory, callbacks: {
  listening(value: boolean): void;
  transcript(value: string): void;
  error(message: string): void;
}, timeoutMs = 10000) {
  let active: CommandRecognition | null = null;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function stop() {
    generation++;
    const previous = active; active = null;
    if (timer) { clearTimeout(timer); timer = undefined; }
    if (previous) {
      previous.onresult = previous.onerror = previous.onend = null;
      try { previous.abort(); } catch { /* Already stopped by the browser. */ }
      callbacks.listening(false);
    }
  }
  return {
    stop,
    start() {
      if (active) return;
      const current = ++generation;
      try {
        const recognizer = factory(); active = recognizer;
        recognizer.lang = 'en-US'; recognizer.continuous = false;
        recognizer.interimResults = false; recognizer.maxAlternatives = 1;
        const valid = () => current === generation && active === recognizer;
        const fail = (code: string) => { if (valid()) { stop(); callbacks.error(recognitionMessage(code)); } };
        recognizer.onresult = event => {
          if (!valid()) return;
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            if (!result?.isFinal) continue;
            const text = result[0]?.transcript.trim() ?? '';
            stop(); // Release the microphone before Moss replies or a room opens.
            if (text) callbacks.transcript(text.slice(0, 201));
            else callbacks.error(recognitionMessage('no-speech'));
            return;
          }
        };
        recognizer.onerror = event => fail(event.error);
        recognizer.onend = () => fail('no-speech');
        callbacks.listening(true);
        timer = setTimeout(() => fail('no-speech'), timeoutMs);
        recognizer.start();
      } catch (error) {
        stop();
        callbacks.error(recognitionMessage(error instanceof Error ? error.name : 'unknown'));
      }
    },
  };
}
