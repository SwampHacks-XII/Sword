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
  const muteLabel = enabled ? 'Mute Moss' : 'Unmute Moss';
  const replayLabel = state === 'blocked' || state === 'unavailable' ? 'Play Moss’s voice' : 'Replay Moss';
  return <div className="moss-voice">
    <button type="button" className="moss-voice-icon" aria-label={muteLabel} title={muteLabel} onClick={() => setEnabled(!enabled)}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 9h4l5-4v14l-5-4H4V9Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        {enabled ? <path d="M17 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          : <path d="m17 9 5 6m0-6-5 6" stroke="currentColor" strokeWidth="2" />}
      </svg>
    </button>
    <button type="button" className="moss-voice-icon" aria-label={replayLabel} title={replayLabel}
      disabled={!available || !autoSpeak || !enabled || busy} onClick={() => { narrator.current?.speak(text); }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 12a8 8 0 1 0 2.5-5.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M4 3v5h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
    {recovery && <span className="hint" role="status">{recovery}</span>}
  </div>;
}
