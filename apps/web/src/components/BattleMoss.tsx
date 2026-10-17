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
  return children({
    guide: active ? <NpcGuide compact message={caption} /> : null,
    voiceControl: <div className="battle-voice-control">
      <button type="button" className="battle-voice-toggle" role="switch" aria-checked={voice.enabled} onClick={() => {
        voice.setEnabled(!voice.enabled);
      }}><span>Moss’s voice</span><span className="battle-voice-state">{voice.enabled ? 'On' : 'Off'}</span></button>
      {voice.state === 'blocked' && <button type="button" className="text-button" onClick={() => voice.narrator.current?.speak(MOSS_CHEER)}>Play Moss’s voice</button>}
      {voice.state === 'unavailable' && <p className="hint" role="status">Voice couldn’t play. Moss’s captions are still available.</p>}
    </div>,
  });
}
