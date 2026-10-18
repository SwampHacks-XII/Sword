import type { ClientMessage } from '../net/messages';
import { confirmLeaveGame } from './confirmLeaveGame';

/** Both the fighting screen and results leave through the same confirmation and return path. */
export async function leaveBattle(send: (message: ClientMessage) => void, returnToGames: () => void) {
  if (!await confirmLeaveGame()) return;
  send({ type: 'lobby.leave' });
  returnToGames();
}
