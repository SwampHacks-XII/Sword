export type NarrationState = 'idle' | 'loading' | 'speaking' | 'blocked' | 'unavailable';

/** Uses the device/browser voice. No audio generation request or API key. */
export function createNarrator(synth: SpeechSynthesis | undefined, makeUtterance: (text: string) => SpeechSynthesisUtterance,
  onState: (state: NarrationState) => void, clock = () => performance.now()) {
  let current: SpeechSynthesisUtterance | null = null;
  let muted = false;
  let fullText = '';
  let wordPosition = 0;
  let wordAt = 0;
  function cancelCurrent() {
    if (!current) return;
    current.onend = null; current.onerror = null; current.onstart = null;
    current.onboundary = null;
    current = null;
    synth?.cancel();
  }
  function stop() {
    cancelCurrent();
    fullText = '';
    onState('idle');
  }
  function position() {
    // Device voices may omit boundary events. Estimate progress only in that gap.
    const words = [...fullText.slice(wordPosition).matchAll(/\S+/g)];
    if (!words.length) return fullText.length;
    const elapsedWords = Math.floor(Math.max(0, clock() - wordAt) * 3 * 1.16 / 1000);
    return wordPosition + words[Math.min(elapsedWords, words.length - 1)]!.index!;
  }
  function startFrom(offset: number) {
    const text = fullText.slice(offset);
    if (!synth || !text.trim()) { fullText = ''; onState('unavailable'); return; }
    try {
      const utterance = makeUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 1.16;
      utterance.pitch = 1.48;
      utterance.volume = muted ? 0 : 1;
      const english = synth.getVoices().filter(voice => /^en(?:-|_)/i.test(voice.lang));
      const lightVoices = english.filter(voice => /zira|samantha|aria|jenny|hazel|libby|susan|ava/i.test(voice.name ?? ''));
      utterance.voice = lightVoices.find(voice => voice.localService) ?? lightVoices[0]
        ?? english.find(voice => voice.localService) ?? english[0] ?? null;
      current = utterance;
      wordPosition = offset; wordAt = clock();
      const finish = (state: NarrationState) => {
        if (current !== utterance) return;
        current = null; fullText = '';
        onState(state);
      };
      utterance.onstart = () => { if (current === utterance) wordAt = clock(); };
      utterance.onboundary = event => {
        if (current !== utterance || event.charIndex < 0 || event.charIndex >= text.length) return;
        wordPosition = offset + event.charIndex; wordAt = clock();
      };
      utterance.onend = () => finish('idle');
      utterance.onerror = () => finish('unavailable');
      onState('speaking');
      synth.speak(utterance);
    } catch { current = null; fullText = ''; onState('unavailable'); }
  }
  return {
    available: Boolean(synth),
    stop,
    setMuted(value: boolean) {
      if (muted === value) return;
      const offset = current ? position() : 0;
      muted = value;
      if (!current) return;
      // Volume is fixed when many device engines start an utterance. Replace only
      // the unfinished suffix, silently when muted, instead of replaying the line.
      cancelCurrent();
      startFrom(offset);
    },
    speak(text: string) {
      stop();
      fullText = text;
      startFrom(0);
    },
  };
}
