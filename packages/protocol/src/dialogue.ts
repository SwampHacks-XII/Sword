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
  ...Object.values(MOSS_REACTIONS).flat(), MOSS_CHEER,
].map(normalize));
/** Guests may request built-in lines. Generated quest text requires a player login. */
export const isPublicMossLine = (text: string) => publicLines.has(normalize(text));
