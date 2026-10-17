import { getSpell } from '../game/spells';
import { otherSlot, type FighterState, type MatchEvent, type MatchState, type PlayerSlot } from '../game/types';
import { useKeyboardSword } from '../hooks/useKeyboardSword';
import { useMatch } from '../hooks/useMatch';
import { CameraPlaceholder } from './CameraPlaceholder';
import { HealthBars } from './HealthBars';
import { Parchment } from './Parchment';
import { SpellPanel } from './SpellPanel';

export function BattleScreen({ match, you, now }: { match: MatchState; you: PlayerSlot; now: number }) {
  const { send, log } = useMatch();
  const fighting = match.phase === 'fighting';
  useKeyboardSword(fighting);
  const mine = match.fighters[you];
  const theirs = match.fighters[otherSlot(you)];

  return (
    <div className="battle">
      <HealthBars you={mine} opponent={theirs} now={now} />
      <SpellPanel fighter={mine} />
      <ul className="event-log" aria-live="polite">
        {log.map(({ id, event }) => <li key={id}>{describe(event, match.fighters, you)}</li>)}
      </ul>
      <CameraPlaceholder />
      {!fighting && (
        <div className="modal">
          <Parchment title={match.winner === you ? 'Victory!' : `${theirs.name} wins`}>
            <div className="row">
              <button type="button" className="link-button" onClick={() => send({ type: 'match.start' })}>rematch</button>
              <button type="button" className="link-button" onClick={() => send({ type: 'lobby.leave' })}>leave</button>
            </div>
          </Parchment>
        </div>
      )}
    </div>
  );
}

function describe(event: MatchEvent, fighters: Record<PlayerSlot, FighterState>, you: PlayerSlot): string {
  const who = (slot: PlayerSlot) => (slot === you ? 'You' : fighters[slot].name);
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
