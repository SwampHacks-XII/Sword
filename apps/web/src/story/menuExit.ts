import { MOSS_COMMAND_REPLIES } from '@sword/protocol';
import type { MossMenuExitCommand } from './commands';

/** Leaving game selection keeps the account signed in; sign-out ends the session. */
export async function executeMenuExit(command: MossMenuExitCommand, options: {
  authenticated: boolean;
  reply(text: string): Promise<boolean>;
  logout(): Promise<void>;
  navigate(screen: 'home' | 'login'): void;
}): Promise<'done' | 'cancelled' | 'failed'> {
  const reply = command.kind === 'leave' ? MOSS_COMMAND_REPLIES.leaveGame
    : options.authenticated ? MOSS_COMMAND_REPLIES.signOut : MOSS_COMMAND_REPLIES.guestSignOut;
  if (!await options.reply(reply)) return 'cancelled';
  try {
    if (command.kind === 'leave') options.navigate('home');
    else if (options.authenticated) await options.logout();
    else options.navigate('login');
    return 'done';
  } catch {
    await options.reply(MOSS_COMMAND_REPLIES.signOutFailed);
    return 'failed';
  }
}
