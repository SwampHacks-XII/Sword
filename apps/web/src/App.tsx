import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { BattleScreen } from './components/BattleScreen';
import { useSession } from './auth/SessionProvider';
import { navigate, useScreen } from './hooks/useScreen';
import { WorldBackdrop } from './components/WorldBackdrop';
import { Storybook } from './components/Storybook';
import { QuestHandoff } from './components/QuestHandoff';
import { MossCommandVoice, type MossCommandVoiceControls } from './components/MossCommandVoice';
import { PLAYER_SLOTS, type PlayerSlot } from './game/types';
import { useMatch } from './hooks/useMatch';
import { useNow } from './hooks/useNow';
import { useSwordPoses } from './hooks/useSwordPoses';
const loadArena = () => import('./scene/Arena');
const Arena = lazy(() => loadArena().then(module => ({ default: module.Arena })));

/** The storybook menus close into Moss's quest handoff, then the server-owned battle. */
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
  // Once the book folds shut it stays shut through quests and rematches, until the story returns to the menus.
  const [bookClosed, setBookClosed] = useState(false);
  if (bookClosed && !quest && !match) setBookClosed(false);
  // Fetch the 3D arena while players gather, so the battle opens without a wait.
  const gathering = !!lobby;
  useEffect(() => { if (gathering) void loadArena(); }, [gathering]);

  const choosingGame = screen === 'practice' || (screen === 'play' && session.authenticated);
  const handoff = !!quest && bookClosed;
  const battle = !!match && !quest;
  const chapter = battle ? 'The duel · Write your own ending' : handoff ? 'Chapter I · The stolen dawn'
    : lobby ? 'The gathering · Two swords, one story' : choosingGame ? 'The crossroads · Choose your duel'
    : screen === 'home' ? 'A tale of two selves' : screen === 'lore' ? 'Prologue · A crack in the mirror' : 'The beginning · Name your hero';

  return (
    <div className={`stage ${battle ? 'stage-battle' : 'stage-story'}`}>
      <WorldBackdrop showKnights={handoff} />
      {battle && <Suspense fallback={null}>
        <Arena you={you} poses={poses} lastHitAt={lastHitAt} shielded={shielded} />
      </Suspense>}
      <header className="world-header">
        <button type="button" className="wordmark" disabled={!!lobby || !!match} onClick={() => navigate('home')} aria-label="Sword home"><span aria-hidden="true">⚔</span> SWORD<span className="wordmark-star" aria-hidden="true">✦</span></button>
        <p>{chapter}</p><span className="world-edition">SwampHacks XII</span>
      </header>
      <main className="overlay">
        {handoff ? <QuestHandoff />
          : match && !quest ? <BattleScreen match={match} you={you} now={now} />
          : <div className="entry-layout storybook-layout">
            <Storybook onClosed={() => setBookClosed(true)}
              onVoiceReply={text => commandVoice.current?.speak(text)} stopVoice={() => commandVoice.current?.stop()} />
          </div>}
      </main>
      <MossCommandVoice controlRef={commandVoice} stopWhen={!!quest || !!match || (!choosingGame && !lobby)} />
      {!battle && <footer className="world-footer"><span>Remember your runes. Rewrite your fate.</span><span>✦ A little magic goes a long way.</span></footer>}
    </div>
  );
}
