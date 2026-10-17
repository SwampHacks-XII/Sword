/** Each narrator/microphone owns a source, so one finishing cannot silence another's activity. */
export function createAudioActivity() {
  const sources = new Map<symbol, 'speech' | 'microphone'>();
  const listeners = new Set<() => void>();
  let snapshot = { speaking: false, listening: false };
  return {
    snapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set(source: symbol, kind: 'speech' | 'microphone', active: boolean) {
      if (active) sources.set(source, kind); else sources.delete(source);
      const values = [...sources.values()];
      const next = { speaking: values.includes('speech'), listening: values.includes('microphone') };
      if (next.speaking === snapshot.speaking && next.listening === snapshot.listening) return;
      snapshot = next;
      listeners.forEach(listener => listener());
    },
  };
}

export const audioActivity = createAudioActivity();
