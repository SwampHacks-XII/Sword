// Story wireframes only. Replace this copy with validated server-provided dialogue
// when Gemini is integrated; no model calls or API keys are used by these scenes.
export const PROLOGUE = [
  { title: 'A familiar face. A terrible omen.', text: [
    'Psst. Yes, you, the one with the sword. I’m Moss, keeper of this very ordinary, definitely-not-cursed glade.',
    'Something has slipped through the mirror between worlds. It has your face, your magic… and absolutely none of your good intentions.',
  ] },
  { title: 'Your evil twin has arrived.', text: [
    'They’re stealing the light from our little world, one spell at a time. And the only magic that can stop them? Yours.',
    'Remember your runes. Trust your sword. Before we begin, tell the story who its hero is.',
  ] },
] as const;
export const QUEST_BRIEFING = {
  title: 'The glade is losing its light.',
  text: [
    'Your evil twin has taken the Dawn Rune and hidden it beyond the meadow. See those violet clouds? That’s their magic spreading.',
    'Face your reflection, break their spell, and bring the morning home. A small quest. Only the fate of the whole glade depends on it.',
  ],
} as const;
