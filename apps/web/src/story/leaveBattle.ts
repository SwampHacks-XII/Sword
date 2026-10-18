import type { ClientMessage } from '../net/messages';
import { confirmLeaveGame } from './confirmLeaveGame';
import type { MenuScreen } from '../hooks/useScreen';

/** Practice entered from the sign-in page returns there, even if an account is signed in. */
export function gameExitScreen(screen: MenuScreen, authenticated: boolean): 'login' | 'play' {
  return screen === 'practice' || !authenticated ? 'login' : 'play';
}

/** Both the fighting screen and results leave through the same confirmation and return path. */
export async function leaveBattle(send: (message: ClientMessage) => void, returnToGames: () => void) {
  if (!await confirmLeaveGame()) return;
  send({ type: 'lobby.leave' });
  returnToGames();
}
