import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { browserCommandRecognition } from '../story/commandRecognition';
import { createHandsFreeListener, type MossListeningMode } from '../story/handsFreeRecognition';
import { handsFreePreference } from '../story/handsFreePreference';
import { audioActivity } from '../audio/activity';
import { mossChime } from '../audio/mossChime';

export function MossCommandInput({ active = false, disabled, onTranscript, stopVoice, example }: {
  active?: boolean; disabled: boolean; onTranscript(text: string): void; stopVoice(): void; example?: string;
}) {
  const [available, setAvailable] = useState(false);
  const [mode, setMode] = useState<MossListeningMode>('off');
  const [manual, setManual] = useState(false);
  const handsFree = useSyncExternalStore(handsFreePreference.subscribe, handsFreePreference.snapshot, () => false);
  const { speaking } = useSyncExternalStore(audioActivity.subscribe, audioActivity.snapshot, audioActivity.snapshot);
  const [visible, setVisible] = useState(true);
  const [started, setStarted] = useState(false);
  const [final, setFinal] = useState(false);
  const [heard, setHeard] = useState('');
  const [error, setError] = useState('');
  const handleTranscript = useRef(onTranscript); handleTranscript.current = onTranscript;
  const listener = useRef<ReturnType<typeof createHandsFreeListener> | null>(null);
  const permitted = useRef(false);
  permitted.current = active && !disabled && visible && !speaking;
  const listening = mode === 'command';
  useEffect(() => {
    const factory = browserCommandRecognition();
    setAvailable(Boolean(factory));
    if (!factory) return;
    let mounted = true;
    const audioSource = Symbol('Moss microphone');
    const input = createHandsFreeListener(factory, {
      mode: value => {
        audioActivity.set(audioSource, 'microphone', value === 'command');
        if (mounted) { setMode(value); if (value === 'off') setStarted(false); }
      },
      started: () => { if (mounted) setStarted(true); },
      wake: () => {
        if (!mounted || !permitted.current) return;
        setHeard(''); setFinal(false); setError('');
        void mossChime.play().catch(() => { /* Voice input still works if audio cannot play. */ });
      },
      preview: text => { if (mounted) setHeard(text); },
      transcript: text => {
        if (!mounted || !permitted.current) return;
        setManual(false); setHeard(text); setFinal(true); handleTranscript.current(text);
      },
      error: (message, recoverable) => {
        if (!mounted) return;
        setManual(false); setError(message);
        if (!recoverable) handsFreePreference.set(false);
      },
    });
    listener.current = input;
    return () => { mounted = false; input.stop(); audioActivity.set(audioSource, 'microphone', false); listener.current = null; };
  }, []);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden');
    update(); document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  useEffect(() => {
    if (!active || disabled || !visible) {
      listener.current?.stop(); setManual(false);
    } else if (speaking) listener.current?.stop();
    else if (manual || handsFree) {
      listener.current?.start(manual ? 'command' : 'wake');
    } else listener.current?.stop();
  }, [active, disabled, visible, speaking, manual, handsFree, mode]);
  function prepare() {
    setHeard(''); setError(''); setFinal(false);
    if (window.isSecureContext === false) {
      setError('Microphone input needs HTTPS. Open the game at its HTTPS address, or use localhost on this computer.');
      return false;
    }
    void mossChime.prepare(); stopVoice();
    return true;
  }
  return <div className={`moss-command-input ${listening ? 'is-listening' : ''}`}>
    <label className="moss-hands-free">
      <input type="checkbox" checked={handsFree} disabled={!active || disabled || !available}
        onChange={event => {
          if (event.target.checked) { if (prepare()) handsFreePreference.set(true); }
          else { listener.current?.stop(); setManual(false); handsFreePreference.set(false); }
        }} />
      <span>Hands-free “Hey Moss”</span>
    </label>
    <div className="moss-command-row">
    <button type="button" className="secondary-button" disabled={!active || disabled || !available} aria-pressed={listening}
      onClick={() => {
        if (listening) { listener.current?.stop(); setManual(false); return; }
        if (!prepare()) return;
        listener.current?.stop(); setManual(true);
      }}>
      <svg width="17" height="20" viewBox="0 0 17 20" fill="none" aria-hidden="true">
        <rect x="5" y="1" width="7" height="11" rx="3.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M2 8v1a6.5 6.5 0 0 0 13 0V8M8.5 15.5V19M5 19h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      {listening ? 'Stop listening' : 'Talk to Moss'}
    </button>
    <p className="heard-command" aria-live="polite">Heard: {heard ? <>“{heard}”{!final && ' (not final yet)'}</> : 'No words received yet.'}</p>
    </div>
    <p className={error ? 'error' : 'hint'} role={error ? 'alert' : 'status'}>{error || (handsFree && speaking ? 'Hands-free pauses while Moss speaks.'
      : mode !== 'off' ? !started ? 'Opening microphone… allow access if your browser asks.'
        : listening ? 'Moss is listening… say one command.' : 'Say “Hey Moss” to hear the chime, then say your command.'
      : !available ? 'Voice commands aren’t available in this browser. You can use the buttons.'
      : example ?? 'Try “Hey Moss, create a game” or “join room code zero one two three.”')}</p>
    {handsFree && <p className="hint hands-free-notice">Your browser’s speech service may process audio while hands-free is on. Listening pauses when you leave this page or hide the tab.</p>}
  </div>;
}
