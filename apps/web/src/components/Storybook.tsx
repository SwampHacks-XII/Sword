import { useState } from 'react';
import { useSession } from '../auth/SessionProvider';
import { useMatch } from '../hooks/useMatch';
import { navigate, useScreen } from '../hooks/useScreen';
import { PROLOGUE } from '../story/chapters';
import { authSpread, useAuthLedger } from './AuthPages';
import { BookMenu, type BookPhase, type BookSpread } from './BookMenu';
import { hubSpread, useHubMenu } from './HubPages';
import { lobbySpread } from './LobbyPages';
import { SwordConnectPanel } from './SwordConnectPanel';

/** Swap in an image path (e.g. '/art/logo.png') once the logo art exists. */
const LOGO_SRC: string | null = null;

const SPREAD = { lore: 0, auth: 1, hub: 2, lobby: 3 } as const;

function CoverPage() {
  return <>
    <span className="book-cover-tagline">A tale of two selves</span>
    <h1 className="book-cover-logo">
      {LOGO_SRC ? <img src={LOGO_SRC} alt="Sword" /> : <><span aria-hidden="true">⚔</span> SWORD <span aria-hidden="true">✦</span></>}
    </h1>
    <span className="book-cover-rule" aria-hidden="true">◆◆◆</span>
    <button type="button" className="quest-button" onClick={() => navigate('lore')}>Start <span aria-hidden="true">→</span></button>
  </>;
}

function loreSpread(): BookSpread {
  const [first, second] = PROLOGUE;
  const page = (text: readonly string[]) => <div className="book-lore">{text.map(line => <p key={line}>{line}</p>)}</div>;
  return {
    left: { kicker: 'Prologue', title: first.title, content: page(first.text) },
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
export function Storybook({ onClosed, onVoiceReply, stopVoice }: {
  onClosed(): void; onVoiceReply(text: string): void; stopVoice(): void;
}) {
  const screen = useScreen();
  const session = useSession();
  const match = useMatch();
  const { lobby, quest } = match;
  const choosingGame = screen === 'practice' || (screen === 'play' && session.authenticated);
  const auth = useAuthLedger();
  const hub = useHubMenu({ guestOnly: screen !== 'play' || !session.authenticated, onVoiceReply });
  // Keep the last lobby so the party is still on its page while the book turns away after leaving.
  const [shownLobby, setShownLobby] = useState(lobby);
  if (lobby && lobby !== shownLobby) setShownLobby(lobby);

  const target = lobby ? SPREAD.lobby : choosingGame ? SPREAD.hub : screen === 'login' || screen === 'play' ? SPREAD.auth : SPREAD.lore;
  const phase: BookPhase = quest ? 'closing' : screen === 'home' && !lobby ? 'cover' : 'open';
  const spreads = [loreSpread(), authSpread(auth), hubSpread(hub, stopVoice), lobbySpread(shownLobby, match)];

  return <div className="storybook">
    <BookMenu className="story-book" label="Sword storybook" showNav={false} interactive={false}
      spreads={spreads} spread={target} phase={phase} cover={<CoverPage />} onClosed={onClosed} />
    {lobby && !quest && <SwordConnectPanel />}
  </div>;
}
