import { useEffect, useRef, useState } from 'react';
import { MOSS_CHEER, type PlayerSlot } from '@sword/protocol';
import { useMatch } from '../hooks/useMatch';
import { useMossSpeech } from '../hooks/useMossSpeech';
import { mossReaction } from '../story/reactions';
import { NpcGuide } from './NpcGuide';

export function BattleMoss({ you, active }: { you: PlayerSlot; active: boolean }) {
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
  return <>
    {active && <NpcGuide compact message={caption} />}
    {voice.available && <div className="battle-voice-control">
      <button type="button" className="text-button" aria-pressed={voice.enabled} onClick={() => {
        voice.setEnabled(!voice.enabled);
      }}>Moss’s voice: {voice.enabled ? 'on' : 'off'}</button>
      {voice.state === 'blocked' && <button type="button" className="text-button" onClick={() => voice.narrator.current?.speak(MOSS_CHEER)}>Play Moss’s voice</button>}
      {voice.state === 'unavailable' && <p className="hint" role="status">Voice couldn’t play. Moss’s captions are still available.</p>}
    </div>}
  </>;
}
