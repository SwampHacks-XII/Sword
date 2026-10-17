interface RecognitionResult {
  isFinal: boolean;
  [index: number]: { transcript: string } | undefined;
}
export interface CommandRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart?: (() => void) | null;
  onnomatch?: (() => void) | null;
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
  if (code === 'not-allowed' || code === 'NotAllowedError') {
    return 'Microphone access wasn’t allowed. Use localhost or HTTPS, allow microphone access, and try again.';
  }
  if (code === 'service-not-allowed' || code === 'language-not-supported') return 'This browser’s speech service isn’t available. Open the game in Chrome and try again.';
  if (code === 'audio-capture') return 'No microphone was found. Check that your microphone is connected.';
  if (code === 'network') return 'The browser’s speech service couldn’t connect. Check your internet connection or try the game in Chrome.';
  if (code === 'not-started') return 'The browser didn’t start speech recognition. Check microphone permission, or open the game in Chrome.';
  if (code === 'unfinished') return 'The browser heard speech but didn’t return a finished transcript. No command was run. Try again or open the game in Chrome.';
  if (code === 'nomatch') return 'The browser couldn’t transcribe that speech. No command was run. Click Talk to Moss and try again.';
  if (code === 'no-speech') return 'I didn’t hear a command. Click the microphone and try again.';
  return 'Voice input couldn’t start. Try again or use the game buttons.';
}

export function createCommandListener(factory: RecognitionFactory, callbacks: {
  listening(value: boolean): void;
  started?(): void;
  preview?(value: string): void;
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
      previous.onstart = previous.onnomatch = null;
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
        let started = false;
        let preview = '';
        recognizer.lang = 'en-US'; recognizer.continuous = false;
        recognizer.interimResults = true; recognizer.maxAlternatives = 1;
        const valid = () => current === generation && active === recognizer;
        const fail = (code: string) => { if (valid()) { stop(); callbacks.error(recognitionMessage(code)); } };
        recognizer.onstart = () => { if (valid()) { started = true; callbacks.started?.(); } };
        recognizer.onnomatch = () => fail('nomatch');
        recognizer.onresult = event => {
          if (!valid()) return;
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            if (!result) continue;
            const text = result[0]?.transcript.trim() ?? '';
            if (!result.isFinal) {
              preview = text.slice(0, 201); callbacks.preview?.(preview); continue;
            }
            stop(); // Release the microphone before Moss replies or a room opens.
            if (text) callbacks.transcript(text.slice(0, 201));
            else callbacks.error(recognitionMessage('no-speech'));
            return;
          }
        };
        recognizer.onerror = event => fail(event.error);
        recognizer.onend = () => fail(preview ? 'unfinished' : started ? 'no-speech' : 'not-started');
        callbacks.listening(true);
        timer = setTimeout(() => fail(preview ? 'unfinished' : started ? 'no-speech' : 'not-started'), timeoutMs);
        recognizer.start();
      } catch (error) {
        stop();
        callbacks.error(recognitionMessage(error instanceof Error ? error.name : 'unknown'));
      }
    },
  };
}
