import { useEffect, useState } from 'react';
import { Parchment } from './Parchment';
import { NpcGuide } from './NpcGuide';

interface StorySceneProps {
  title: string; paragraphs: readonly string[]; chapter: string;
  action: string; onContinue(): void; disabled?: boolean; status?: string;
  onLeave?(): void; page?: string; error?: string | null;
}
/** Animated dialogue wireframe; its content is currently local placeholder copy. */
export function StoryScene({ title, paragraphs, chapter, action, onContinue, disabled, status, onLeave, page, error }: StorySceneProps) {
  const total = paragraphs.join('').length;
  const [visible, setVisible] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setVisible(total); return; }
    setVisible(0);
    const timer = window.setInterval(() => setVisible(count => {
      if (count >= total) { window.clearInterval(timer); return total; }
      return Math.min(total, count + 3);
    }), 23);
    return () => window.clearInterval(timer);
  }, [total, title]);
  let offset = 0;
  return <Parchment className="story-scroll dialogue-scroll">
    <div className="scroll-kicker"><span>{chapter}</span><span>{page || 'Story preview'}</span></div>
    <div className="scroll-flourish" aria-hidden="true">✦</div>
    <h1>{title}</h1>
    <div className="speaker-line"><span className="speaker-dot" /> Moss <span>Keeper of the glade</span></div>
    <div className="story-dialogue">
      <div className="sr-only" aria-live="polite">{paragraphs.map(text => <p key={text}>{text}</p>)}</div>
      <div aria-hidden="true">{paragraphs.map(text => {
        const count = Math.max(0, Math.min(text.length, visible - offset)); offset += text.length;
        return <p key={text}><span className="dialogue-reserve">{text}</span><span className="dialogue-reveal">{text.slice(0, count)}{count > 0 && count < text.length && <span className="typing-cursor">▎</span>}</span></p>;
      })}</div>
    </div>
    <div className="dialogue-toolbar">
      {visible < total ? <button type="button" className="text-button" onClick={() => setVisible(total)}>Show all dialogue <span aria-hidden="true">↠</span></button>
        : <span className="dialogue-finished">A new page is waiting.</span>}
    </div>
    <div className="story-actions">
      <button type="button" className="quest-button" disabled={disabled} onClick={onContinue}>{action}<span aria-hidden="true">→</span></button>
      {status && <p className="hint quest-status" role="status">{status}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {onLeave && <button type="button" className="text-button" onClick={onLeave}>Leave this quest</button>}
    </div>
    <NpcGuide message="A little courage goes a long way." />
  </Parchment>;
}
