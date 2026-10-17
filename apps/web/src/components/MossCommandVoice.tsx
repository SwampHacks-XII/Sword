import { useEffect, useImperativeHandle, useState, type Ref } from 'react';
import { useMossSpeech } from '../hooks/useMossSpeech';

export interface MossCommandVoiceControls { speak(text: string): void; stop(): void }
/** Remains mounted when game selection turns into a lobby, so replies finish. */
export function MossCommandVoice({ controlRef, stopWhen }: { controlRef: Ref<MossCommandVoiceControls>; stopWhen: boolean }) {
  const { narrator } = useMossSpeech(true);
  const [line, setLine] = useState('');
  useImperativeHandle(controlRef, () => ({
    speak(text) { setLine(text); narrator.current?.speak(text); },
    stop() { setLine(''); narrator.current?.stop(); },
  }), [narrator]);
  useEffect(() => {
    if (stopWhen) { setLine(''); narrator.current?.stop(); }
  }, [stopWhen, narrator]);
  useEffect(() => {
    if (!line) return;
    const timer = setTimeout(() => setLine(''), 8000);
    return () => clearTimeout(timer);
  }, [line]);
  return !stopWhen && line ? <p className="moss-command-reply" role="status"><strong>Moss</strong> {line}</p> : null;
}
