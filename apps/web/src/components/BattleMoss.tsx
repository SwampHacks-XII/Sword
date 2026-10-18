import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MOSS_CHEER, type PlayerSlot } from '@sword/protocol';
import { useMatch } from '../hooks/useMatch';
import { useMossSpeech } from '../hooks/useMossSpeech';
import { mossReaction } from '../story/reactions';
import { NpcGuide } from './NpcGuide';

/** Own one narrator while letting the battle place its switch and guide in separate layout rows. */
export function BattleMoss({ you, active, children }: {
  you: PlayerSlot; active: boolean;
  children(parts: { guide: ReactNode; voiceControl: ReactNode }): ReactNode;
}) {
  const { log } = useMatch();
  const voice = useMossSpeech();
  const seen = useRef<number | undefined>(log.at(-1)?.id);
  const spokenAt = useRef(-Infinity);
  const [caption, setCaption] = useState('Choose your spell. Let your courage do the rest.');
  useEffect(() => {
    if (!active) { voice.narrator.current?.stop(); return; }
    const fresh = log.filter(entry => entry.id > (seen.current ?? -1));
    if (!fresh.length) return;
    seen.current = log.at(-1)?.id;
    const line = fresh.reverse().map(entry => mossReaction(entry.event, you, entry.id)).find(Boolean);
    if (!line) return;
    setCaption(line);
    // Drop reactions while Moss speaks instead of building an audio backlog.
    if (voice.state !== 'speaking' && voice.state !== 'loading' && performance.now() - spokenAt.current >= 2500) {
      spokenAt.current = performance.now();
      voice.narrator.current?.speak(line);
    }
  }, [log, you, active, voice.state, voice.narrator]);
  // A small speaker badge on Moss’s portrait turns the voice on or off.
  const toggle = <button type="button" className="battle-voice-icon" role="switch" aria-checked={voice.enabled}
    aria-label="Moss’s voice" title={voice.enabled ? 'Mute Moss' : 'Unmute Moss'} onClick={() => voice.setEnabled(!voice.enabled)}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 9h4l5-4v14l-5-4H4V9Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      {voice.enabled ? <path d="M17 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        : <path d="m17 9 5 6m0-6-5 6" stroke="currentColor" strokeWidth="2" />}
    </svg>
  </button>;
  const needsHelp = voice.state === 'blocked' || voice.state === 'unavailable';
  return children({
    guide: active ? <NpcGuide compact message={caption} badge={toggle} /> : null,
    // Only shown when the voice can't play; the on/off switch lives on Moss's portrait.
    voiceControl: needsHelp && <div className="battle-voice-control">
      {voice.state === 'blocked' && <button type="button" className="text-button" onClick={() => voice.narrator.current?.speak(MOSS_CHEER)}>Play Moss’s voice</button>}
      {voice.state === 'unavailable' && <p className="hint" role="status">Voice couldn’t play. Moss’s captions are still available.</p>}
    </div>,
  });
}
