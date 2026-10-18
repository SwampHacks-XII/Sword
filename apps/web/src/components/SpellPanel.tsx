import { GESTURE_LABELS, getSpell } from '../game/spells';
import { FitText } from './FitText';
import type { FighterState } from '../game/types';
import { GESTURE_KEYS, KEY_BUTTONS } from '../hooks/useKeyboardSword';
import { useNow } from '../hooks/useNow';
import { Parchment } from './Parchment';
import { DAMAGE_RANGES, SPELL_DIFFICULTIES, HEAL_RANGE, HEAL_USES, SWORD_MOTION_LABELS } from '@sword/protocol';
import { useMatch } from '../hooks/useMatch';
import { useSerialSword } from '../hooks/useSerialSword';

const COLOR_KEYS = Object.fromEntries(Object.entries(KEY_BUTTONS).map(([key, color]) => [color, key]));

/** Your current spell: rune sequence (flat circles for now), then motion, then fire. */
export function SpellPanel({ fighter, disabled = false }: { fighter: FighterState; disabled?: boolean }) {
  const { send } = useMatch();
  const sword = useSerialSword();
  const swordReady = sword.status === 'ready';
  const spell = fighter.spellId ? getSpell(fighter.spellId) : null;
  const armed = fighter.castPhase === 'armed';
  const now = useNow(100, true);
  const healWait = Math.max(0, Math.ceil(((fighter.healReadyAt ?? 0) - now) / 1000));
  const remaining = armed && fighter.armedUntil && fighter.armedAt
    ? Math.max(0, (fighter.armedUntil - now) / (fighter.armedUntil - fighter.armedAt))
    : 0;

  return (
    <Parchment className="spell-panel">
      {!spell ? <>
        {sword.firing && <div className="armed"><p>FIRING — aim your sword at your opponent!</p></div>}
        <p className="label">Your next move</p>
        <h2 className="spell-name"><FitText>Choose your spell difficulty</FitText></h2>
        <div className="difficulty-options">
          {SPELL_DIFFICULTIES.map(difficulty => <button type="button" className={`difficulty-button difficulty-${difficulty}`} key={difficulty}
            disabled={disabled || swordReady} onClick={() => send({ type: 'spell.choose', difficulty })}>
            <span>{difficulty}</span><small>{DAMAGE_RANGES[difficulty].join('–')} damage · {difficulty === 'easy' ? 3 : difficulty === 'medium' ? 5 : 7} runes</small>
          </button>)}
        </div>
        <p className="hint">{swordReady
          ? 'Sword buttons: red easy · yellow medium · green hard · blue heal.'
          : 'Receive one random spell from your chosen difficulty.'}</p>
      </> : <>
      <p className="label">{spell.difficulty} · {spell.damageRange.join('–')} damage</p>
      <h2 className="spell-name"><FitText>{spell.name}</FitText></h2>
      <ol className="runes">
        {spell.combo.map((color, i) => (
          <li key={i} className={`rune rune-${color} ${i < fighter.entered ? 'lit' : ''}`}>
            <span className="rune-key">{COLOR_KEYS[color]}</span>
          </li>
        ))}
      </ol>
      <div className={`step ${fighter.castPhase === 'motion' ? 'active' : ''}`}>
        {swordReady
          ? <>Then move your sword: {[...spell.swordMotions].map(m => SWORD_MOTION_LABELS[m]).join(' → ')}</>
          : <>Then: {GESTURE_LABELS[spell.gesture]} <kbd>{GESTURE_KEYS[spell.gesture]}</kbd></>}
      </div>
      {armed && (
        <div className="armed">
          <p>ARMED — aim and fire <kbd>Space</kbd></p>
          <div className="armed-bar"><div style={{ width: `${remaining * 100}%` }} /></div>
        </div>
      )}
      <p className="hint">{swordReady
        ? 'Press the runes on your sword, then make the motions. It fires IR for up to 10 seconds — aim!'
        : 'Keys stand in for the sword: 1–4 runes · Q/E/R/W motions · Space fire'}</p>
      </>}
      <div className="heal-control">
        <button type="button" className="heal-button" disabled={disabled || fighter.healUsesRemaining <= 0 || healWait > 0 || fighter.hp >= fighter.maxHp}
          onClick={() => send({ type: 'player.heal' })}>
          {healWait > 0 && fighter.healUsesRemaining > 0 ? `Heal ready in ${healWait}s` : 'Heal'}
          <small>{fighter.healUsesRemaining} of {HEAL_USES} uses left · +{HEAL_RANGE.join('–')} HP</small>
        </button>
        <p className="hint">{fighter.healUsesRemaining === 0 ? 'Both heals used this battle.' : fighter.hp >= fighter.maxHp ? 'Your health is full.' : 'Five-second cooldown between heals.'}</p>
      </div>
    </Parchment>
  );
}
