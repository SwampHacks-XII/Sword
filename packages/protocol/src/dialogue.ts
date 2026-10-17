import { FALLBACK_BRIEFINGS } from './quests.js';

export const MOSS_PROLOGUE = [
  { title: 'A familiar face. A terrible omen.', text: [
    'Psst. Yes, you, the one with the sword. I’m Moss, keeper of this very ordinary, definitely-not-cursed glade.',
    'Something has slipped through the mirror between worlds. It has your face, your magic… and absolutely none of your good intentions.',
  ] },
  { title: 'Your evil twin has arrived.', text: [
    'They’re stealing the light from our little world, one spell at a time. And the only magic that can stop them? Yours.',
    'Remember your runes. Trust your sword. Before we begin, tell the story who its hero is.',
  ] },
] as const;
export const MOSS_CHEER = 'I’m cheering you on, adventurer!';
export const MOSS_COMMAND_REPLIES = {
  create: 'Got it! I’m opening a new game for you.',
  bot: 'Got it! Let’s find Swamp Bot for a friendly duel.',
  unknown: 'Ask me to create a game, join a room, play with Swamp Bot, sign out, or leave the game.',
  code: 'Tell me the four room digits, one at a time.',
  login: 'Sign in first, adventurer. Then I can open an online game for you.',
  name: 'Your hero needs a name! Enter one before we begin.',
  saveName: 'Save your hero’s name first, adventurer. Then we can open a game!',
  busy: 'One little moment! I’m still opening your room.',
  failed: 'That room didn’t open. Check the room code or connection and try again.',
  lobbyUnknown: 'Here in the lobby, ask me to start your quest or leave the room.',
  startQuest: 'Let’s turn the page and begin your quest!',
  leaveRoom: 'Got it! Let’s return to the crossroads.',
  waitForRival: 'Your rival hasn’t arrived yet. We need both players before the quest begins.',
  hostOnly: 'The room’s host must begin this quest. Your adventure will start together.',
  reconnecting: 'One moment, adventurer. We’re reconnecting to the game server.',
  lobbyBusy: 'One moment, adventurer. Your room is still getting ready.',
  signOut: 'Signing you out. Until our next adventure!',
  leaveGame: 'Leaving the game. Back to the welcome page!',
  guestSignOut: 'You’re playing as a guest. Let’s return to sign-in.',
  signOutFailed: 'I couldn’t sign you out. Please try again.',
} as const;
export const MOSS_REACTIONS = {
  hit: ['Good hit!', 'Nicely done!', 'That’s the spirit!', 'A little magic, a mighty hit!'],
  hurt: ['Shake it off, adventurer!', 'Your twin got that one!', 'Keep your courage up!'],
  miss: ['That one missed!', 'So close! Try again!', 'Steady your sword!'],
  fizzle: ['Your spell fizzled. Try again!', 'Aim before the magic fades!'],
  heal: ['A little healing magic!', 'Back on your feet!', 'Feeling better, brave one?'],
} as const;

const normalize = (text: string) => text.trim().replace(/\s+/g, ' ');
const publicLines = new Set<string>([
  ...MOSS_PROLOGUE.map(chapter => chapter.text.join(' ')), ...FALLBACK_BRIEFINGS,
  ...Object.values(MOSS_REACTIONS).flat(), ...Object.values(MOSS_COMMAND_REPLIES), MOSS_CHEER,
].map(normalize));
/** Guests may request built-in lines. Generated quest text requires a player login. */
export const isPublicMossLine = (text: string) => publicLines.has(normalize(text));
