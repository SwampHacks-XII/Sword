import type { ReactNode } from 'react';
import type { FighterState } from '../game/types';

export function HealthBars({ you, opponent, now, children }: { you: FighterState; opponent: FighterState; now: number; children?: ReactNode }) {
  return (
    <div className="health-bars">
      <HealthBar fighter={you} label="You" now={now} />
      <HealthBar fighter={opponent} label="Opponent" now={now} />
      {children && <div className="health-bars-footer">{children}</div>}
    </div>
  );
}

function HealthBar({ fighter, label, now }: { fighter: FighterState; label: string; now: number }) {
  const shielded = fighter.shieldUntil !== null && fighter.shieldUntil > now;
  const slowed = fighter.slowedUntil !== null && fighter.slowedUntil > now;
  return (
    <div className="health">
      <div className="health-label">
        <span>{fighter.name} <small>({label})</small></span>
        <span>{fighter.hp} / {fighter.maxHp}</span>
      </div>
      <div className="health-track">
        <div className="health-fill" style={{ width: `${(fighter.hp / fighter.maxHp) * 100}%` }} />
      </div>
      <div className="chips">
        {shielded && <span className="chip chip-shield">Shielded</span>}
        {slowed && <span className="chip chip-slow">Slowed</span>}
      </div>
    </div>
  );
}
