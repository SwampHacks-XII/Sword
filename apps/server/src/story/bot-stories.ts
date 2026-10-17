import { prepareQuest, type QuestGenerator } from '@sword/protocol';
import { ApiError } from '../game/errors.js';

/** Authenticated bot games get the same bounded prefetch as multiplayer rooms. */
export function createBotStories(generate?: QuestGenerator) {
  const sessions = new Map<string, { round: number; previous: string[]; pending: ReturnType<typeof prepareQuest>; expires: number }>();
  const rates = new Map<string, { since: number; count: number }>();
  return async (subject: string, sessionId: string, roundNumber: number) => {
    const now = Date.now();
    for (const [key, session] of sessions) if (session.expires < now) { session.pending.dispose(); sessions.delete(key); }
    for (const [key, rate] of rates) if (now - rate.since > 60_000) rates.delete(key);
    const key = `${subject}:${sessionId}`;
    let session = sessions.get(key);
    if (!session || session.round !== roundNumber) {
      if ((!session && roundNumber !== 1) || (session && roundNumber !== session.round + 1)) {
        throw new ApiError(409, 'invalid_round', 'Start a new bot game before requesting that round.');
      }
      let rate = rates.get(subject);
      if (!rate) { rate = { since: now, count: 0 }; rates.set(subject, rate); }
      if (++rate.count > 10 || rates.size > 1000 || (!session && sessions.size >= 500)) {
        throw new ApiError(429, 'story_limit', 'Moss is resting. A local quest is available instead.');
      }
      const previous = session?.previous ?? [];
      // Awaiters for the previous round retain their own promise; new rounds cannot overwrite them.
      session?.pending.dispose();
      session = { round: roundNumber, previous,
        pending: prepareQuest({ roundNumber, previousBriefings: [...previous] }, generate, 3500), expires: now + 30 * 60_000 };
      sessions.set(key, session);
      const current = session;
      void current.pending.get().then(story => {
        current.previous = [...previous, story.briefing].slice(-20);
      });
    }
    return { story: await session.pending.get(), roundNumber };
  };
}
