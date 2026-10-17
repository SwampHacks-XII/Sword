import type { NarrationState } from './narration';
import { createNarrator } from './narration';

interface AudioNarrationOptions {
  load: (text: string, signal: AbortSignal) => Promise<Blob>;
  makeAudio: (url: string) => HTMLAudioElement;
  createUrl: (blob: Blob) => string;
  revokeUrl: (url: string) => void;
  timeoutMs?: number;
}

/** Main audio voice plus a device voice; cancellation prevents late audio from another page. */
export function createMossNarrator(synth: SpeechSynthesis | undefined,
  makeUtterance: (text: string) => SpeechSynthesisUtterance,
  onState: (state: NarrationState) => void, options: AudioNarrationOptions) {
  let version = 0;
  let controller: AbortController | null = null;
  let audio: HTMLAudioElement | null = null;
  let url: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let muted = false;
  const browser = createNarrator(synth, makeUtterance, onState);
  function release() {
    if (timer) { clearTimeout(timer); timer = undefined; }
    controller?.abort(); controller = null;
    if (audio) { audio.onended = null; audio.onerror = null; audio.pause(); audio.removeAttribute('src'); audio = null; }
    if (url) { options.revokeUrl(url); url = null; }
  }
  function stop() { version++; release(); browser.stop(); onState('idle'); }
  return {
    available: true,
    stop,
    setMuted(value: boolean) {
      muted = value;
      if (audio) audio.muted = value;
      browser.setMuted(value);
    },
    speak(text: string) {
      stop();
      const current = version;
      controller = new AbortController();
      const signal = controller.signal;
      onState('loading');
      let fellBack = false;
      const fallback = () => {
        if (version !== current || fellBack) return;
        fellBack = true;
        release();
        browser.speak(text);
      };
      timer = setTimeout(fallback, options.timeoutMs ?? 4000);
      void Promise.resolve().then(() => options.load(text, signal)).then(async blob => {
        if (version !== current || fellBack) return;
        url = options.createUrl(blob);
        audio = options.makeAudio(url);
        const element = audio;
        element.playbackRate = 1.15;
        element.preservesPitch = true;
        element.muted = muted;
        element.onended = () => { if (version === current && !fellBack) { release(); onState('idle'); } };
        element.onerror = fallback;
        await element.play();
        if (version !== current || fellBack || audio !== element) return;
        if (timer) { clearTimeout(timer); timer = undefined; }
        onState('speaking');
      }).catch(error => {
        if (version !== current || fellBack) return;
        if (error && typeof error === 'object' && 'name' in error && error.name === 'NotAllowedError') {
          release();
          onState('blocked');
        } else fallback();
      });
    },
  };
}
