import { lazy, Suspense, useRef } from 'react';
import { BattleScreen } from './components/BattleScreen';
import { LobbyScreen } from './components/LobbyScreen';
import { MainMenu } from './components/MainMenu';
import { WelcomeScreen } from './components/WelcomeScreen';
import { LoginScreen } from './components/LoginScreen';
import { useSession } from './auth/SessionProvider';
import { navigate, useScreen } from './hooks/useScreen';
import { WorldBackdrop } from './components/WorldBackdrop';
import { PrologueScreen } from './components/PrologueScreen';
import { QuestScreen } from './components/QuestScreen';
import { MossCommandVoice, type MossCommandVoiceControls } from './components/MossCommandVoice';
import { PLAYER_SLOTS, type PlayerSlot } from './game/types';
import { useMatch } from './hooks/useMatch';
import { useNow } from './hooks/useNow';
import { useSwordPoses } from './hooks/useSwordPoses';
const Arena = lazy(() => import('./scene/Arena').then(module => ({ default: module.Arena })));

/** Menu steps precede the server-owned lobby and battle screens. */
export function App() {
  const screen = useScreen();
  const session = useSession();
  const commandVoice = useRef<MossCommandVoiceControls>(null);
  const { lobby, match, quest, lastHitAt } = useMatch();
  const poses = useSwordPoses();
  const you = lobby?.you ?? 'p1';
  // Re-render a few times a second during a match so shield/slow timers expire on screen.
  const now = useNow(250, !!match);
  const shielded = Object.fromEntries(
    PLAYER_SLOTS.map((slot) => [slot, (match?.fighters[slot].shieldUntil ?? 0) > now]),
  ) as Record<PlayerSlot, boolean>;
  const choosingGame = screen === 'practice' || (screen === 'play' && session.authenticated);
  const chapter = match ? 'The duel · Write your own ending' : quest ? 'Chapter I · The stolen dawn'
    : lobby ? 'The gathering · Two swords, one story' : choosingGame ? 'The crossroads · Choose your duel'
    : screen === 'home' ? 'A tale of two selves' : screen === 'prologue' ? 'Prologue · A crack in the mirror' : 'The beginning · Name your hero';

  return (
    <div className={`stage ${match ? 'stage-battle' : 'stage-story'} ${quest || screen === 'prologue' ? 'stage-dialogue' : ''}`}>
      <WorldBackdrop showKnights={(!lobby && !match) || !!quest} />
      {(lobby || match) && !quest && <Suspense fallback={null}>
        <Arena you={you} poses={poses} lastHitAt={lastHitAt} shielded={shielded} />
      </Suspense>}
      <header className="world-header">
        <button type="button" className="wordmark" disabled={!!lobby || !!match} onClick={() => navigate('home')} aria-label="Sword home"><span aria-hidden="true">⚔</span> SWORD<span className="wordmark-star" aria-hidden="true">✦</span></button>
        <p>{chapter}</p><span className="world-edition">SwampHacks XII</span>
      </header>
      <main className="overlay">
        {quest ? <div className="entry-layout"><QuestScreen /></div>
          : match ? <BattleScreen match={match} you={you} now={now} />
          : lobby ? <LobbyScreen lobby={lobby}
            onVoiceReply={text => commandVoice.current?.speak(text)} stopVoice={() => commandVoice.current?.stop()} />
          : <div className="entry-layout">
            {screen === 'home' ? <WelcomeScreen />
              : screen === 'prologue' ? <PrologueScreen />
              : choosingGame ? <MainMenu guestOnly={screen === 'practice'}
                onVoiceReply={text => commandVoice.current?.speak(text)} stopVoice={() => commandVoice.current?.stop()} />
              : <LoginScreen />}
          </div>}
      </main>
      <MossCommandVoice controlRef={commandVoice} stopWhen={!!quest || !!match || (!choosingGame && !lobby)} />
      {!match && <footer className="world-footer"><span>Remember your runes. Rewrite your fate.</span><span>✦ A little magic goes a long way.</span></footer>}
    </div>
  );
}
