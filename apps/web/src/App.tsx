import { BattleScreen } from './components/BattleScreen';
import { LobbyScreen } from './components/LobbyScreen';
import { MainMenu } from './components/MainMenu';
import { PLAYER_SLOTS, type PlayerSlot } from './game/types';
import { useMatch } from './hooks/useMatch';
import { useNow } from './hooks/useNow';
import { useSwordPoses } from './hooks/useSwordPoses';
import { Arena } from './scene/Arena';

/** The screen is derived from server state: no lobby → menu, lobby → lobby, match → battle. */
export function App() {
  const { lobby, match, lastHitAt } = useMatch();
  const poses = useSwordPoses();
  const you = lobby?.you ?? 'p1';
  // Re-render a few times a second during a match so shield/slow timers expire on screen.
  const now = useNow(250, !!match);
  const shielded = Object.fromEntries(
    PLAYER_SLOTS.map((slot) => [slot, (match?.fighters[slot].shieldUntil ?? 0) > now]),
  ) as Record<PlayerSlot, boolean>;

  return (
    <div className="stage">
      <Arena you={you} poses={poses} lastHitAt={lastHitAt} shielded={shielded} />
      <main className="overlay">
        {match ? <BattleScreen match={match} you={you} now={now} />
          : lobby ? <LobbyScreen lobby={lobby} />
          : <MainMenu />}
      </main>
    </div>
  );
}
