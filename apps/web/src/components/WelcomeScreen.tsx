import { navigate } from '../hooks/useScreen';
import { Parchment } from './Parchment';
import { NpcGuide } from './NpcGuide';

export function WelcomeScreen() {
  return (
    <Parchment className="story-scroll welcome-screen">
      <div className="scroll-kicker"><span>A tale of two selves</span><span>Prologue</span></div>
      <div className="scroll-flourish" aria-hidden="true">✦</div>
      <p className="eyebrow">Once upon a time, there was… you.</p>
      <h1 className="welcome-title">One face.<br /><em>Two fates.</em></h1>
      <p className="welcome-copy">A quiet glade. A magic sword.<br />And an enemy who looks a little too familiar.</p>
      <p className="welcome-copy welcome-copy-last">Your evil twin is rewriting the story.<br />Shall we give it a better ending?</p>
      <div className="story-actions">
        <button type="button" className="quest-button" onClick={() => navigate('prologue')}>I’ll draw my destiny <span aria-hidden="true">→</span></button>
        <p className="handwritten-note">Your next chapter starts with a little courage.</p>
      </div>
      <NpcGuide message="Psst. Our world could use a hero like you." />
    </Parchment>
  );
}
