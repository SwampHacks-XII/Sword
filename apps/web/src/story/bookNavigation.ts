export const BOOK_SPREAD = { lore: 0, auth: 1, hub: 2, sword: 3, lobby: 4 } as const;
// The first leaf runs at 80% of its original speed (900ms / .8 = 1125ms).
export const BOOK_TIMING = { turn: 1500, open: 1100, firstPagePause: 40, firstPageTurn: 1125, firstPageFallback: 120, fold: 1300, shrink: 600 } as const;

/** The first leaf turns only after the cover has finished opening. */
export function playBookOpening(show: (stage: 'opening' | 'first-page' | 'revealing' | 'open') => void): () => void {
  show('opening');
  const timers = [
    setTimeout(() => show('first-page'), BOOK_TIMING.open),
    setTimeout(() => show('revealing'), BOOK_TIMING.open + BOOK_TIMING.firstPagePause),
    // The leaf's animationend normally completes the opening. Allow paint scheduling time
    // before this fallback, so a timer cannot remove the leaf just before it lands.
    setTimeout(() => show('open'), BOOK_TIMING.open + BOOK_TIMING.firstPagePause + BOOK_TIMING.firstPageTurn + BOOK_TIMING.firstPageFallback),
  ];
  return () => timers.forEach(clearTimeout);
}

let settledSpread: number | null = null;
const listeners = new Set<(spread: number | null) => void>();

/** Called only after the book has reached its destination, or null when it unmounts. */
export function reportBookArrival(spread: number | null) {
  settledSpread = spread;
  listeners.forEach(listener => listener(spread));
}

function waitForBookArrival(destination: number): Promise<void> {
  if (settledSpread === null || settledSpread === destination) return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timeout); listeners.delete(arrive); resolve(); };
    const arrive = (spread: number | null) => { if (spread === destination || spread === null) finish(); };
    // A hidden tab or an interrupted animation must never prevent signing out.
    const timeout = setTimeout(finish, BOOK_TIMING.turn * 3);
    listeners.add(arrive);
  });
}

/** Leave the current spread visibly before Auth0's full-page logout redirect. */
export async function signOutFromBook(navigateToLogin: () => void, logout: () => Promise<void>) {
  navigateToLogin();
  await waitForBookArrival(BOOK_SPREAD.auth);
  await logout();
}
