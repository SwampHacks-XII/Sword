import { getSpell } from '../game/spells';
import { otherSlot, type FighterState, type MatchEvent, type MatchState, type PlayerSlot } from '../game/types';
import { useKeyboardSword } from '../hooks/useKeyboardSword';
import { useMatch } from '../hooks/useMatch';
import { useSerialSword } from '../hooks/useSerialSword';
import { CameraPlaceholder } from './CameraPlaceholder';
import { HealthBars } from './HealthBars';
import { Parchment } from './Parchment';
import { SpellPanel } from './SpellPanel';
import { BattleMoss } from './BattleMoss';

export function BattleScreen({ match, you, now }: { match: MatchState; you: PlayerSlot; now: number }) {
  const { send, log, lobby, onlineStatus, error } = useMatch();
  const sword = useSerialSword();
  const fighting = match.phase === 'fighting';
  const online = lobby?.mode === 'online';
  const connected = !online || (onlineStatus === 'open' && lobby?.players.every(p => p.connected));
  useKeyboardSword(fighting && connected);
  const mine = match.fighters[you];
  const theirs = match.fighters[otherSlot(you)];

  return (
    <div className="battle">
      <HealthBars you={mine} opponent={theirs} now={now} />
      <SpellPanel fighter={mine} disabled={!fighting || !connected} />
      <ul className="event-log" aria-live="polite">
        {log.map(({ id, event }) => <li key={id}>{describe(event, match.fighters, you)}</li>)}
      </ul>
      <CameraPlaceholder />
      <BattleMoss you={you} active={fighting} />
      <div className="battle-controls">
        <p>{online ? 'Online' : 'Swamp Bot'} · {sword.status === 'ready' ? 'physical sword' : 'keyboard practice'}</p>
        {sword.error && <p className="error" role="alert">{sword.error}</p>}
        {!connected && <p role="status">Waiting for both players to reconnect…</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <button type="button" className="link-button small" onClick={() => send({ type: 'lobby.leave' })}>leave game</button>
      </div>
      {!fighting && (
        <div className="modal">
          <Parchment className="ending-scroll" title={match.winner === you ? 'The light returns.' : 'Even heroes stumble.'}>
            <p>{match.winner === you ? 'Your reflection falls. A new dawn begins.' : `${theirs.name} takes this chapter. Your story isn’t over.`}</p>
            <div className="row">
              <button type="button" className="quest-button" disabled={!connected} onClick={() => send({ type: 'match.rematch' })}>Rematch <span aria-hidden="true">↻</span></button>
              <button type="button" className="link-button small" onClick={() => send({ type: 'lobby.leave' })}>Close this chapter</button>
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
