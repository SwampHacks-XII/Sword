import { GESTURE_LABELS, getSpell } from '../game/spells';
import type { FighterState } from '../game/types';
import { GESTURE_KEYS, KEY_BUTTONS } from '../hooks/useKeyboardSword';
import { useNow } from '../hooks/useNow';
import { Parchment } from './Parchment';

const COLOR_KEYS = Object.fromEntries(Object.entries(KEY_BUTTONS).map(([key, color]) => [color, key]));

/** Your current spell: rune sequence (flat circles for now), then motion, then fire. */
export function SpellPanel({ fighter }: { fighter: FighterState }) {
  const spell = getSpell(fighter.spellId);
  const armed = fighter.castPhase === 'armed';
  const now = useNow(100, armed);
  const remaining = armed && fighter.armedUntil && fighter.armedAt
    ? Math.max(0, (fighter.armedUntil - now) / (fighter.armedUntil - fighter.armedAt))
    : 0;

  return (
    <Parchment className="spell-panel">
      <h2 className="spell-name">{spell.name}</h2>
      <ol className="runes">
        {spell.combo.map((color, i) => (
          <li key={i} className={`rune rune-${color} ${i < fighter.entered ? 'lit' : ''}`}>
            <span className="rune-key">{COLOR_KEYS[color]}</span>
          </li>
        ))}
      </ol>
      <div className={`step ${fighter.castPhase === 'motion' ? 'active' : ''}`}>
        Then: {GESTURE_LABELS[spell.gesture]} <kbd>{GESTURE_KEYS[spell.gesture]}</kbd>
      </div>
      {armed && (
        <div className="armed">
          <p>ARMED — aim and fire <kbd>Space</kbd></p>
          <div className="armed-bar"><div style={{ width: `${remaining * 100}%` }} /></div>
        </div>
      )}
      <p className="hint">Keys stand in for the sword: 1–4 runes · Q/E/R/W motions · Space fire</p>
    </Parchment>
  );
}
