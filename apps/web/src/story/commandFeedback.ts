import type { NarrationState } from './narration';

/** A route-changing command waits for its acknowledgement, with a bounded fallback. */
export function createCommandFeedback(options: {
  speak(text: string): void; stop(): void; show(text: string): void;
}, timeoutMs = 7000) {
  let pending: { resolve(value: boolean): void; started: boolean; state: NarrationState; timer: ReturnType<typeof setTimeout> } | null = null;
  function finish(value: boolean) {
    const current = pending; pending = null;
    if (current) { clearTimeout(current.timer); current.resolve(value); }
  }
  return {
    stateChanged(state: NarrationState) {
      if (!pending) return;
      pending.state = state;
      if (state === 'loading' || state === 'speaking') pending.started = true;
      else if (state !== 'idle') finish(true);
      else if (pending.started) {
        // Switching from ElevenLabs to browser speech briefly reports idle.
        const current = pending;
        queueMicrotask(() => { if (pending === current && current.state === 'idle') finish(true); });
      }
    },
    speak(text: string): Promise<boolean> {
      finish(false);
      options.show(text);
      return new Promise(resolve => {
        pending = { resolve, started: false, state: 'idle', timer: setTimeout(() => {
          finish(true); options.stop();
        }, timeoutMs) };
        try { options.speak(text); } catch { finish(true); }
      });
    },
    stop() { finish(false); options.stop(); options.show(''); },
  };
}
