import { navigate } from '../hooks/useScreen';

export function WelcomeScreen() {
  return (
    <section className="welcome-screen" aria-labelledby="welcome-title">
      <p className="eyebrow">SwampHacks XII · A magic sword duel</p>
      <h1 id="welcome-title" className="welcome-title">Sword<span>Remember the spell.<br />Make your move.</span></h1>
      <p className="welcome-copy">Challenge a friend or train with Swamp Bot. Learn your spell, enter the runes, and swing to cast.</p>
      <button type="button" className="primary-button" onClick={() => navigate('login')}>Get started <span aria-hidden="true">→</span></button>
      <ol className="welcome-steps" aria-label="How to play">
        <li><span>01</span> Choose your opponent</li>
        <li><span>02</span> Prepare your spell</li>
        <li><span>03</span> Enter the arena</li>
      </ol>
      <p className="welcome-note">Keyboard controls are ready. Physical swords are coming next.</p>
    </section>
  );
}
