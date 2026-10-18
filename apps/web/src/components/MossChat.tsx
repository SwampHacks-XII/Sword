import { useRef } from 'react';
import { useTypewriter } from '../hooks/useTypewriter';
import { MossVoice, type MossVoiceControls } from './MossVoice';

/** A little chat window: Moss on the left, typed message bubbles on the right. */
export function MossChat({ lines, onContinue }: { lines: readonly string[]; onContinue(): void }) {
  const voice = useRef<MossVoiceControls>(null);
  const text = lines.join(' ');
  const [visible, showAll] = useTypewriter(text.length + lines.length - 1);
  const done = visible >= text.length + lines.length - 1;
  let offset = 0;

  return <section className="moss-chat" role="dialog" aria-label="A message from Moss">
    <header className="moss-chat-bar">
      <span className="moss-chat-dots" aria-hidden="true"><i /><i /><i /></span>
      <span>Moss · whispering from the glade</span>
    </header>
    <div className="moss-chat-body">
      <div className="moss-chat-portrait">
        <div className="npc-moss" role="img" aria-label="Moss, a tiny smiling green forest spirit with a pink flower" />
        <span className="moss-chat-name"><span className="speaker-dot" /> Moss</span>
        <MossVoice text={text} controlRef={voice} />
      </div>
      <div className="moss-chat-log">
        <div className="sr-only" aria-live="polite">{lines.map(line => <p key={line}>{line}</p>)}</div>
        <div aria-hidden="true">{lines.map(line => {
          const count = Math.max(0, Math.min(line.length, visible - offset));
          offset += line.length + 1;
          return count > 0 && <p key={line} className="moss-chat-bubble">
            {line.slice(0, count)}{count < line.length && <span className="typing-cursor">▎</span>}
          </p>;
        })}</div>
      </div>
    </div>
    <footer className="moss-chat-footer">
      {done ? <button type="button" className="quest-button" onClick={() => { voice.current?.stop(); onContinue(); }}>Show me the scroll <span aria-hidden="true">→</span></button>
        : <button type="button" className="text-button" onClick={showAll}>Show all <span aria-hidden="true">↠</span></button>}
    </footer>
  </section>;
}
