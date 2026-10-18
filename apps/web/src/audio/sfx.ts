let pageTurn: HTMLAudioElement | null = null;

/** Restarts the page-turn rustle so quick consecutive turns each get their own sound. */
export function playPageTurn() {
  try {
    pageTurn ??= Object.assign(new Audio('/audio/page-turn.mp3'), { preload: 'auto', volume: 1 });
    pageTurn.currentTime = 0;
    void pageTurn.play().catch(() => { /* Autoplay may be blocked before the first interaction. */ });
  } catch { /* Sound effects are optional. */ }
}
