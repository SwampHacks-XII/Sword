import { useCallback, useEffect, useRef, useState } from 'react';
import type { NarrationState } from '../story/narration';
import { createMossNarrator } from '../story/elevenLabsNarration';
import { loadMossAudio } from '../net/voice';
import { useSession } from '../auth/SessionProvider';

const preference = 'sword.mossVoice';
const preferenceChanged = 'sword:mossVoiceChanged';
export function useMossSpeech(defaultEnabled = true) {
  const session = useSession();
  const identity = useRef(session);
  identity.current = session;
  const [state, setState] = useState<NarrationState>('idle');
  const [available, setAvailable] = useState(false);
  const [enabled, setEnabledState] = useState(() => {
    try {
      const saved = localStorage.getItem(preference);
      return saved === null ? defaultEnabled : saved === 'on';
    } catch { return defaultEnabled; }
  });
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const narrator = useRef<ReturnType<typeof createMossNarrator> | null>(null);
  useEffect(() => {
    const sync = (event: Event) => {
      if (event instanceof StorageEvent && event.key !== preference && event.key !== null) return;
      let value = enabledRef.current;
      if (event instanceof CustomEvent && typeof event.detail === 'boolean') value = event.detail;
      else { try { value = localStorage.getItem(preference) !== 'off'; } catch { /* Keep the current preference. */ } }
      enabledRef.current = value; setEnabledState(value); narrator.current?.setMuted(!value);
    };
    window.addEventListener(preferenceChanged, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(preferenceChanged, sync); window.removeEventListener('storage', sync); };
  }, []);
  useEffect(() => {
    const synth = typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined'
      ? window.speechSynthesis : undefined;
    const voice = createMossNarrator(synth, words => new SpeechSynthesisUtterance(words), setState, {
      load: (text, signal) => {
        return loadMossAudio(text, () => identity.current.authenticated ? identity.current.getToken()
          : Promise.reject(new Error('A generated quest requires player login')), signal);
      },
      makeAudio: url => new Audio(url), createUrl: blob => URL.createObjectURL(blob), revokeUrl: url => URL.revokeObjectURL(url),
    });
    voice.setMuted(!enabledRef.current);
    narrator.current = voice;
    setAvailable(voice.available);
    try { synth?.getVoices(); } catch { /* ElevenLabs audio can still play without device voices. */ }
    return () => { voice.stop(); narrator.current = null; };
  }, []);
  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value);
    try { localStorage.setItem(preference, value ? 'on' : 'off'); } catch { /* Storage is optional. */ }
    enabledRef.current = value;
    narrator.current?.setMuted(!value);
    window.dispatchEvent(new CustomEvent(preferenceChanged, { detail: value }));
  }, []);
  return { state, available, enabled, setEnabled, narrator };
}
