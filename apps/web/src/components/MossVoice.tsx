import { useEffect, useImperativeHandle, type Ref } from 'react';
import { useMossSpeech } from '../hooks/useMossSpeech';

export interface MossVoiceControls { stop(): void }
export function MossVoice({ text, controlRef, autoSpeak = true }: {
  text: string; controlRef?: Ref<MossVoiceControls>; autoSpeak?: boolean;
}) {
  const { state, narrator, available, enabled, setEnabled } = useMossSpeech(true);
  useImperativeHandle(controlRef, () => ({ stop: () => narrator.current?.stop() }), [narrator]);
  const busy = state === 'speaking' || state === 'loading';
  // Cold audio loads keep the same controls; only genuine playback failures need a message.
  const recovery = available && enabled && autoSpeak
    ? state === 'blocked' ? 'Your browser paused autoplay. Press Play Moss’s voice to listen.'
      : state === 'unavailable' ? 'Voice couldn’t play. You can still read the story.' : null
    : null;
  useEffect(() => {
    if (!available || !autoSpeak) return;
    narrator.current?.speak(text);
    return () => narrator.current?.stop();
  }, [text, narrator, available, autoSpeak]);
  return <div className="moss-voice">
    <button type="button" className="text-button" aria-pressed={!enabled} onClick={() => setEnabled(!enabled)}>
      {enabled ? 'Mute Moss' : 'Unmute Moss'} <span aria-hidden="true">♫</span>
    </button>
    <button type="button" className="text-button" disabled={!available || !autoSpeak || !enabled || busy} onClick={() => {
      narrator.current?.speak(text);
    }}>{state === 'blocked' || state === 'unavailable' ? 'Play Moss’s voice' : 'Replay audio'}</button>
    {recovery && <span className="hint" role="status">{recovery}</span>}
  </div>;
}
