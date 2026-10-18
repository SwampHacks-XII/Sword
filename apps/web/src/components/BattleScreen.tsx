import { useEffect, useRef } from 'react';
import { getSpell } from '../game/spells';
import { otherSlot, type FighterState, type MatchEvent, type MatchState, type PlayerSlot } from '../game/types';
import { useKeyboardSword } from '../hooks/useKeyboardSword';
import { useMatch } from '../hooks/useMatch';
import { useSerialSword } from '../hooks/useSerialSword';
import { HealthBars } from './HealthBars';
import { Parchment } from './Parchment';
import { SpellPanel } from './SpellPanel';
import { BattleMoss } from './BattleMoss';
import { MOSS_ENDINGS } from '@sword/protocol';
import { MossVoice } from './MossVoice';
import { CastTimer } from './CastTimer';

export function BattleScreen({ match, you, now }: { match: MatchState; you: PlayerSlot; now: number }) {
  const { send, log, lobby, onlineStatus, error } = useMatch();
  const sword = useSerialSword();
  const fighting = match.phase === 'fighting';
  const online = lobby?.mode === 'online';
  const connected = !online || (onlineStatus === 'open' && lobby?.players.every(p => p.connected));
  useKeyboardSword(fighting && connected && sword.status !== 'ready');
  const mine = match.fighters[you];
  const theirs = match.fighters[otherSlot(you)];
  const endingLine = match.winner === you ? MOSS_ENDINGS.win : MOSS_ENDINGS.loss;
  const eventLog = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (eventLog.current) eventLog.current.scrollTop = eventLog.current.scrollHeight;
  }, [log]);

  return (
    <div className="battle">
      <SpellPanel fighter={mine} disabled={!fighting || !connected} />
      {fighting && <CastTimer fighter={mine} firingUntil={sword.firingUntil} />}
      {fighting && <BattleMoss you={you} active>{({ guide, voiceControl }) =>
        <div className="battle-left-hud">
          <div className="battle-status">
            <HealthBars you={mine} opponent={theirs} now={now} />
            <div className="battle-controls">
              {voiceControl}
              {sword.error && <p className="error" role="alert">{sword.error}</p>}
              {!connected && <p role="status">Waiting for both players to reconnect…</p>}
              {error && <p className="error" role="alert">{error}</p>}
            </div>
          </div>
          <div className="battle-conversation">
            {guide}
            <ul ref={eventLog} className="event-log" aria-label="Battle log" aria-live="polite">
              {log.map(({ id, event }) => <li key={id}>{describe(event, match.fighters, you)}</li>)}
            </ul>
          </div>
        </div>
      }</BattleMoss>}
      {!fighting && (
        <div className="modal">
          <Parchment className="ending-scroll" title={match.winner === you ? 'The light returns.' : 'Even heroes stumble.'}>
            <p>{match.winner === you ? 'Your reflection falls. A new dawn begins.' : `${theirs.name} takes this chapter. Your story isn’t over.`}</p>
            <div className="ending-moss">
              <div className="npc-moss" aria-hidden="true" />
              <div>
                <div className="speaker-line"><span className="speaker-dot" /> Moss <MossVoice text={endingLine} /></div>
                <p>{endingLine}</p>
              </div>
            </div>
            <div className="row">
              <button type="button" className="quest-button" disabled={!connected} onClick={() => send({ type: 'match.rematch' })}>Rematch <span aria-hidden="true">↻</span></button>
            </div>
          </Parchment>
        </div>
      )}
    </div>
  );
}

function describe(event: MatchEvent, fighters: Record<PlayerSlot, FighterState>, you: PlayerSlot): string {
  const who = (slot: PlayerSlot) => (slot === you ? 'You' : fighters[slot].name);
  if (event.kind === 'heal') return `${who(event.slot)} recovered ${event.amount} HP`;
  const spell = getSpell(event.spellId).name;
  switch (event.kind) {
    case 'cast': return `${who(event.slot)} cast ${spell}`;
    case 'hit': return event.blocked
      ? `${who(event.victim)} blocked ${spell}`
      : `${who(event.attacker)} hit ${who(event.victim)} with ${spell} for ${event.damage}`;
    case 'miss': return `${who(event.attacker)} missed with ${spell}`;
    case 'fizzle': return `${who(event.slot)} let ${spell} fizzle`;
  }
}
