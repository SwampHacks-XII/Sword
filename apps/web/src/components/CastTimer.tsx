import { SWORD_FIRE_WINDOW_MS, type FighterState } from '../game/types';
import { useNow } from '../hooks/useNow';
import { Parchment } from './Parchment';

/** Keyboard aiming and physical IR firing share the bottom-screen timer. */
export function CastTimer({ fighter, firingUntil }: { fighter: FighterState; firingUntil: number | null }) {
  const now = useNow(100, true);
  const firing = firingUntil !== null;
  const end = firing ? firingUntil : fighter.castPhase === 'armed' ? fighter.armedUntil : null;
  const start = firing && end !== null ? end - SWORD_FIRE_WINDOW_MS : fighter.armedAt;
  if (end === null || start === null || end <= now) return null;
  const remaining = Math.max(0, Math.min(1, (end - now) / Math.max(1, end - start)));
  return <Parchment className="cast-timer">
    <p>{firing ? 'Aim at the other sword’s receiver' : <>Aim and fire <kbd>Space</kbd></>}</p>
    <output className="cast-timer-seconds" aria-label="Seconds remaining">{Math.ceil((end - now) / 1000)}s</output>
    <div className="armed-bar" role="progressbar" aria-label={firing ? 'Sword firing time remaining' : 'Time remaining to fire'}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(remaining * 100)}>
      <div style={{ width: `${remaining * 100}%` }} />
    </div>
  </Parchment>;
}
