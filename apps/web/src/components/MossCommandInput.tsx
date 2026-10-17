import { useEffect, useRef, useState } from 'react';
import { browserCommandRecognition, createCommandListener } from '../story/commandRecognition';

export function MossCommandInput({ disabled, onTranscript, stopVoice }: {
  disabled: boolean; onTranscript(text: string): void; stopVoice(): void;
}) {
  const [available, setAvailable] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [error, setError] = useState('');
  const handleTranscript = useRef(onTranscript); handleTranscript.current = onTranscript;
  const listener = useRef<ReturnType<typeof createCommandListener> | null>(null);
  useEffect(() => {
    const factory = browserCommandRecognition();
    setAvailable(Boolean(factory));
    if (!factory) return;
    let mounted = true;
    const input = createCommandListener(factory, {
      listening: value => { if (mounted) setListening(value); },
      transcript: text => {
        if (!mounted) return;
        setHeard(text); handleTranscript.current(text);
      },
      error: message => { if (mounted) setError(message); },
    });
    listener.current = input;
    return () => { mounted = false; input.stop(); listener.current = null; };
  }, []);
  useEffect(() => { if (disabled) listener.current?.stop(); }, [disabled]);
  return <div className={`moss-command-input ${listening ? 'is-listening' : ''}`}>
    <button type="button" className="secondary-button" disabled={disabled || !available} aria-pressed={listening}
      onClick={() => {
        if (listening) { listener.current?.stop(); return; }
        stopVoice(); setHeard(''); setError(''); listener.current?.start();
      }}>
      <svg width="17" height="20" viewBox="0 0 17 20" fill="none" aria-hidden="true">
        <rect x="5" y="1" width="7" height="11" rx="3.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M2 8v1a6.5 6.5 0 0 0 13 0V8M8.5 15.5V19M5 19h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      {listening ? 'Stop listening' : 'Talk to Moss'}
    </button>
    <p className="hint" role="status">{listening ? 'Moss is listening… say one command.'
      : !available ? 'Voice commands aren’t available in this browser. You can use the buttons.'
      : 'Try “Hey Moss, create a game” or “join room code zero one two three.”'}</p>
    {available && <p className="voice-input-notice">Listens once per click. Your browser may send audio to its speech service.</p>}
    {heard && <p className="heard-command">Heard: “{heard}”</p>}
    {error && <p className="hint" role="alert">{error}</p>}
  </div>;
}
