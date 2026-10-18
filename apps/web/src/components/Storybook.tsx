import { useCallback, useEffect, useState } from 'react';
import { MOSS_PROLOGUE_NARRATION } from '@sword/protocol';
import { useSession } from '../auth/SessionProvider';
import { useMatch } from '../hooks/useMatch';
import { navigate, useScreen } from '../hooks/useScreen';
import { PROLOGUE } from '../story/chapters';
import { authSpread, useAuthLedger } from './AuthPages';
import { BookMenu, type BookPhase, type BookSpread } from './BookMenu';
import { hubSpread, useHubMenu } from './HubPages';
import { lobbySpread, useLobbyControls } from './LobbyPages';
import { swordSetupSpread } from './SwordSetupPages';
import { BOOK_SPREAD as SPREAD, reportBookArrival } from '../story/bookNavigation';
import { MossVoice } from './MossVoice';

function CoverPage() {
  return <>
    <span className="book-cover-tagline">A tale of two selves</span>
    <h1 className="book-cover-logo">
      <span aria-hidden="true">⚔</span> HEXDUEL <span aria-hidden="true">✦</span>
    </h1>
    <span className="book-cover-rule" aria-hidden="true">◆◆◆</span>
    <button type="button" className="quest-button" onClick={() => navigate('lore')}>Start <span aria-hidden="true">→</span></button>
  </>;
}

function loreSpread(narrate: boolean): BookSpread {
  const [first, second] = PROLOGUE;
  const page = (text: readonly string[]) => <div className="book-lore">{text.map(line => <p key={line}>{line}</p>)}</div>;
  return {
    left: { kicker: 'Prologue', title: first.title, content: <>
      <div className="book-lore-moss">
        <div className="npc-moss" role="img" aria-label="Moss, your tiny green forest guide" />
        <div className="speaker-line"><span className="speaker-dot" /> Moss
          <MossVoice text={MOSS_PROLOGUE_NARRATION} autoSpeak={narrate} /></div>
      </div>
      {page(first.text)}
    </> },
    right: {
      kicker: 'A crack in the mirror', title: second.title,
      content: <>
        {page(second.text)}
        <div className="book-lore-actions">
          <button type="button" className="quest-button" onClick={() => navigate('login')}>Let the story know my name <span aria-hidden="true">→</span></button>
          <button type="button" className="link-button small" onClick={() => navigate('home')}>← Close the book</button>
        </div>
      </>,
    },
  };
}

/**
 * Every menu before the quest lives in one storybook: the cover, the lore, sign-in, choosing a game and
 * the lobby are spreads, and app state turns the pages. When the quest begins the book folds shut.
 */
export function Storybook({ onClosed, onVoiceReply, stopVoice, swordReady, onSwordReady }: {
  onClosed(): void; onVoiceReply(text: string): Promise<boolean>; stopVoice(): void;
  swordReady: boolean; onSwordReady(): void;
}) {
  const screen = useScreen();
  const [arrivedSpread, setArrivedSpread] = useState<number | null>(null);
  useEffect(() => { if (screen === 'home') setArrivedSpread(null); }, [screen]);
  const bookArrived = useCallback((index: number) => {
    reportBookArrival(index);
    setArrivedSpread(index);
  }, []);
  useEffect(() => () => reportBookArrival(null), []);
  const session = useSession();
  const match = useMatch();
  const { lobby, quest } = match;
  const choosingGame = screen === 'practice' || (screen === 'play' && session.authenticated);
  const auth = useAuthLedger();
  const hub = useHubMenu({ guestOnly: screen !== 'play' || !session.authenticated, onVoiceReply, stopVoice });
  const lobbyControls = useLobbyControls(lobby, { onVoiceReply, stopVoice });
  // Keep the last lobby so the party is still on its page while the book turns away after leaving.
  const [shownLobby, setShownLobby] = useState(lobby);
  if (lobby && lobby !== shownLobby) setShownLobby(lobby);

  const target = lobby ? swordReady ? SPREAD.lobby : SPREAD.sword : choosingGame ? SPREAD.hub : screen === 'login' || screen === 'play' ? SPREAD.auth : SPREAD.lore;
  const phase: BookPhase = quest && swordReady ? 'closing' : screen === 'home' && !lobby ? 'cover' : 'open';
  const canNarrate = phase === 'open' && arrivedSpread === target && !lobby;
  const spreads = [loreSpread(screen === 'lore' && canNarrate),
    authSpread(auth, target === SPREAD.auth && canNarrate), hubSpread(hub, stopVoice),
    swordSetupSpread(onSwordReady, () => void lobbyControls.submitCommand({ kind: 'leave' })),
    lobbySpread(shownLobby, match, lobbyControls)];

  return <div className="storybook">
    <BookMenu className="story-book" label="Sword storybook" showNav={false} interactive={false}
      spreads={spreads} spread={target} phase={phase} cover={<CoverPage />} onClosed={onClosed}
      openingPage={{ kicker: 'A tale of two selves', title: 'Every hero has a shadow.',
        text: 'Remember your runes. Rewrite your fate.' }}
      onSpreadChange={bookArrived} />
  </div>;
}
