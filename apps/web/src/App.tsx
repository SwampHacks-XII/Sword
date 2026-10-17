import { lazy, Suspense } from 'react';
import { BattleScreen } from './components/BattleScreen';
import { LobbyScreen } from './components/LobbyScreen';
import { MainMenu } from './components/MainMenu';
import { WelcomeScreen } from './components/WelcomeScreen';
import { LoginScreen } from './components/LoginScreen';
import { useSession } from './auth/SessionProvider';
import { useScreen } from './hooks/useScreen';
import { PLAYER_SLOTS, type PlayerSlot } from './game/types';
import { useMatch } from './hooks/useMatch';
import { useNow } from './hooks/useNow';
import { useSwordPoses } from './hooks/useSwordPoses';
const Arena = lazy(() => import('./scene/Arena').then(module => ({ default: module.Arena })));

/** Menu steps precede the server-owned lobby and battle screens. */
export function App() {
  const screen = useScreen();
  const session = useSession();
  const { lobby, match, lastHitAt } = useMatch();
  const poses = useSwordPoses();
  const you = lobby?.you ?? 'p1';
  // Re-render a few times a second during a match so shield/slow timers expire on screen.
  const now = useNow(250, !!match);
  const shielded = Object.fromEntries(
    PLAYER_SLOTS.map((slot) => [slot, (match?.fighters[slot].shieldUntil ?? 0) > now]),
  ) as Record<PlayerSlot, boolean>;
  const choosingGame = screen === 'practice' || (screen === 'play' && session.authenticated);
  const step = match ? 4 : lobby ? 3 : choosingGame ? 2 : screen === 'home' ? 0 : 1;
  const steps = ['Welcome', 'Log in / Sign up', 'Choose game', 'Lobby', 'Battle'];

  return (
    <div className="stage">
      {!lobby && !match && <div className="welcome-backdrop" aria-hidden="true" />}
      {(lobby || match) && <Suspense fallback={<div className="welcome-backdrop" aria-hidden="true" />}>
        <Arena you={you} poses={poses} lastHitAt={lastHitAt} shielded={shielded} />
      </Suspense>}
      <main className="overlay">
        {!match && <ol className="flow-progress" aria-label="Game setup progress">
          {steps.map((label, index) => <li key={label} aria-current={index === step ? 'step' : undefined} className={index < step ? 'complete' : ''}>
            <span aria-hidden="true">{index + 1}</span>{label}
          </li>)}
        </ol>}
        {match ? <BattleScreen match={match} you={you} now={now} />
          : lobby ? <LobbyScreen lobby={lobby} />
          : <div className="entry-layout">
            {screen === 'home' ? <WelcomeScreen />
              : choosingGame ? <MainMenu guestOnly={screen === 'practice'} />
              : <LoginScreen />}
          </div>}
      </main>
    </div>
  );
}
