import { useRef } from 'react';
import { useTypewriter } from '../hooks/useTypewriter';
import { Parchment } from './Parchment';
import { NpcGuide } from './NpcGuide';
import { MossVoice, type MossVoiceControls } from './MossVoice';

interface StorySceneProps {
  title: string; paragraphs: readonly string[];
  action: string; onContinue(): void; disabled?: boolean; status?: string;
  onLeave?(): void; page?: string; error?: string | null;
  narration?: boolean;
}
/** Animated dialogue shared by the fixed prologue and server-provided quests. */
export function StoryScene({ title, paragraphs, action, onContinue, disabled, status, onLeave, page, error, narration = true }: StorySceneProps) {
  const total = paragraphs.join('').length;
  const voice = useRef<MossVoiceControls>(null);
  const [visible, showAll] = useTypewriter(total, title);
  let offset = 0;
  return <Parchment className="story-scroll dialogue-scroll">
    <h1>{title}</h1>
    <div className="speaker-line"><span className="speaker-dot" /> Moss</div>
    {narration && <MossVoice text={paragraphs.join(' ')} controlRef={voice} />}
    <div className="story-dialogue">
      <div className="sr-only" aria-live="polite">{paragraphs.map(text => <p key={text}>{text}</p>)}</div>
      <div aria-hidden="true">{paragraphs.map(text => {
        const count = Math.max(0, Math.min(text.length, visible - offset)); offset += text.length;
        return <p key={text}><span className="dialogue-reserve">{text}</span><span className="dialogue-reveal">{text.slice(0, count)}{count > 0 && count < text.length && <span className="typing-cursor">▎</span>}</span></p>;
      })}</div>
    </div>
    <div className="dialogue-toolbar">
      {page && <span className="dialogue-page">Page {page}</span>}
      {visible < total ? <button type="button" className="text-button" onClick={showAll}>Show all dialogue <span aria-hidden="true">↠</span></button>
        : <span className="dialogue-finished">A new page is waiting.</span>}
    </div>
    <div className="story-actions">
      <button type="button" className="quest-button" disabled={disabled} onClick={() => { voice.current?.stop(); onContinue(); }}>{action}<span aria-hidden="true">→</span></button>
      {status && <p className="hint quest-status" role="status">{status}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {onLeave && <button type="button" className="secondary-button leave-game-button" onClick={onLeave}>Leave game <span aria-hidden="true">↗</span></button>}
    </div>
    <NpcGuide message="A little courage goes a long way." />
  </Parchment>;
}
