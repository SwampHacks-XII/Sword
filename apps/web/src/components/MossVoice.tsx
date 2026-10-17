import { useEffect, useImperativeHandle, type Ref } from 'react';
import { useMossSpeech } from '../hooks/useMossSpeech';

export interface MossVoiceControls { stop(): void }
export function MossVoice({ text, controlRef }: { text: string; controlRef?: Ref<MossVoiceControls> }) {
  const { state, narrator, available, enabled, setEnabled } = useMossSpeech(true);
  useImperativeHandle(controlRef, () => ({ stop: () => narrator.current?.stop() }), [narrator]);
  const busy = state === 'speaking' || state === 'loading';
  useEffect(() => {
    if (!available) return;
    narrator.current?.speak(text);
    return () => narrator.current?.stop();
  }, [text, narrator, available]);
  if (!available) return <span className="hint">Read Moss’s words below.</span>;
  return <div className="moss-voice">
    <button type="button" className="text-button" aria-pressed={!enabled} onClick={() => setEnabled(!enabled)}>
      {enabled ? 'Mute Moss' : 'Unmute Moss'} <span aria-hidden="true">♫</span>
    </button>
    {enabled && !busy && <button type="button" className="text-button" onClick={() => {
      narrator.current?.speak(text);
    }}>{state === 'blocked' || state === 'unavailable' ? 'Play Moss’s voice' : 'Replay audio'}</button>}
    <span className="hint" role="status">{!enabled ? '' : state === 'loading' ? 'Preparing Moss’s voice…'
      : state === 'blocked' ? 'Your browser paused autoplay. Press Play Moss’s voice to listen.'
      : state === 'unavailable' ? 'Voice couldn’t play. You can still read the story.'
      : ''}</span>
  </div>;
}
