import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { useMossSpeech } from '../hooks/useMossSpeech';
import { createCommandFeedback } from '../story/commandFeedback';

export interface MossCommandVoiceControls { speak(text: string): Promise<boolean>; stop(): void }
/** Remains mounted when game selection turns into a lobby, so replies finish. */
export function MossCommandVoice({ controlRef, stopWhen }: { controlRef: Ref<MossCommandVoiceControls>; stopWhen: boolean }) {
  const feedback = useRef<ReturnType<typeof createCommandFeedback> | null>(null);
  const { narrator } = useMossSpeech(true, state => feedback.current?.stateChanged(state));
  const [line, setLine] = useState('');
  if (!feedback.current) feedback.current = createCommandFeedback({
    speak: text => {
      if (narrator.current) narrator.current.speak(text);
      else feedback.current?.stateChanged('unavailable');
    },
    stop: () => narrator.current?.stop(), show: setLine,
  });
  useImperativeHandle(controlRef, () => ({
    speak: text => feedback.current!.speak(text),
    stop: () => feedback.current!.stop(),
  }), []);
  useEffect(() => {
    if (stopWhen) feedback.current?.stop();
  }, [stopWhen]);
  useEffect(() => () => feedback.current?.stop(), []);
  useEffect(() => {
    if (!line) return;
    const timer = setTimeout(() => setLine(''), 8000);
    return () => clearTimeout(timer);
  }, [line]);
  return !stopWhen && line ? <p className="moss-command-reply" role="status"><strong>Moss</strong> {line}</p> : null;
}
