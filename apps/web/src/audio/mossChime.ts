/** Unlock on an explicit user gesture; reuse the context across book page turns. */
export function createMossChime(makeContext: () => AudioContext | null = () => {
  const browser = window as typeof window & { webkitAudioContext?: typeof AudioContext };
  const Constructor = browser.AudioContext ?? browser.webkitAudioContext;
  return Constructor ? new Constructor() : null;
}) {
  let context: AudioContext | null = null;
  async function prepare() {
    try {
      context ??= makeContext();
      if (context?.state === 'suspended') await context.resume();
    } catch { /* A blocked chime must never block a voice command. */ }
  }
  return {
    prepare,
    async play() {
      await prepare();
      if (!context || context.state !== 'running') return;
      const now = context.currentTime;
      for (const [offset, frequency] of [[0, 659.25], [.11, 987.77]] as const) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine'; oscillator.frequency.value = frequency;
        const start = now + offset;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(.07, start + .015);
        gain.gain.exponentialRampToValueAtTime(.001, start + .20);
        oscillator.connect(gain); gain.connect(context.destination);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(start); oscillator.stop(start + .21);
      }
    },
  };
}

export const mossChime = createMossChime();
