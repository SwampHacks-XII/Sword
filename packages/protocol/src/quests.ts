export interface QuestStory {
  title: string;
  briefing: string;
  source: 'gemini' | 'fallback';
}
export interface QuestContext { roundNumber: number; previousBriefings: readonly string[] }
export type QuestGenerator = (context: QuestContext, signal: AbortSignal) => Promise<QuestStory>;

const tales = [
  ['The chicken caper', 'Your evil twin has kidnapped the village chickens and crowned their rooster king. Rescue the flock before breakfast becomes a royal affair!'],
  ['A very sticky spell', 'Your evil twin has turned the glade’s river into honey. Break their sticky spell before the frogs get stuck on their way home!'],
  ['The missing moon', 'Your evil twin has stuffed the moon inside a teapot. Win it back before the sleepy owls miss their midnight picnic!'],
  ['Trouble in the treetops', 'Your evil twin has stolen every squirrel’s winter acorns. Stop them before the forest’s tiniest knights march into battle!'],
  ['The runaway pumpkins', 'Your evil twin has enchanted the village pumpkins to roll away. Break the spell before our autumn feast disappears over the hill!'],
  ['A chorus of chaos', 'Your evil twin has taught the mushrooms to shout instead of sing. Save the glade’s lullaby before nobody gets any sleep!'],
  ['The great sock heist', 'Your evil twin has stolen every left sock in the kingdom. Face your reflection and bring warmth back to our very confused toes!'],
  ['A cloudy predicament', 'Your evil twin has tied all the rain clouds to their castle. Free them before the meadow flowers forget how to bloom!'],
] as const;
export const FALLBACK_BRIEFINGS: readonly string[] = tales.map(([, briefing]) => briefing);

const normalized = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase();
export function isQuestStory(value: unknown): value is QuestStory {
  if (!value || typeof value !== 'object') return false;
  const story = value as QuestStory;
  return typeof story.title === 'string' && story.title.trim().length > 0 && story.title.length <= 80
    && typeof story.briefing === 'string' && story.briefing.trim().length > 0 && story.briefing.length <= 600
    && story.briefing.trim().split(/\s+/u).length < 50
    && (story.source === 'gemini' || story.source === 'fallback');
}
export function fallbackQuest(roundNumber: number, previousBriefings: readonly string[] = []): QuestStory {
  const recent = new Set(previousBriefings.slice(-tales.length + 1).map(normalized));
  const start = Math.max(0, roundNumber - 1) % tales.length;
  const [title, briefing] = Array.from({ length: tales.length }, (_, i) => tales[(start + i) % tales.length]!)
    .find(([, text]) => !recent.has(normalized(text))) ?? tales[start]!;
  return { title, briefing, source: 'fallback' };
}

/** Prefetch in the lobby; reveal one immutable story with a bounded foreground wait. */
export function prepareQuest(context: QuestContext, generate?: QuestGenerator, waitMs = 800) {
  const controller = new AbortController();
  const fallback = fallbackQuest(context.roundNumber, context.previousBriefings);
  let ready: QuestStory | null = generate ? null : fallback;
  let frozen: QuestStory | null = null;
  let revealing: Promise<QuestStory> | undefined;
  const pending = generate ? Promise.resolve().then(() => generate(context, controller.signal)).then(story => {
    if (!controller.signal.aborted && isQuestStory(story)
      && !context.previousBriefings.some(text => normalized(text) === normalized(story.briefing))) ready = story;
    else ready = fallback;
  }, () => { ready = fallback; }) : Promise.resolve();
  return {
    peek: () => frozen ?? ready,
    get(): Promise<QuestStory> {
      if (revealing) return revealing;
      revealing = (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          if (!ready) await Promise.race([pending, new Promise<void>(resolve => { timer = setTimeout(resolve, waitMs); })]);
          frozen = ready ?? fallback;
          if (frozen.source === 'fallback') controller.abort();
          return frozen;
        } finally { if (timer) clearTimeout(timer); }
      })();
      return revealing;
    },
    dispose() { controller.abort(); },
  };
}
