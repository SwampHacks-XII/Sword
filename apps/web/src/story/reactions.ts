import { MOSS_REACTIONS, type MatchEvent, type PlayerSlot } from '@sword/protocol';
export { MOSS_REACTIONS } from '@sword/protocol';

export function mossReaction(event: MatchEvent, you: PlayerSlot, variation: number): string | null {
  const key = event.kind === 'hit' && !event.blocked ? (event.attacker === you ? 'hit' : 'hurt')
    : event.kind === 'miss' && event.attacker === you ? 'miss'
    : event.kind === 'fizzle' && event.slot === you ? 'fizzle'
    : event.kind === 'heal' && event.slot === you ? 'heal' : null;
  if (!key) return null;
  const bank = MOSS_REACTIONS[key];
  return bank[Math.abs(variation) % bank.length]!;
}
