import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import './BookMenu.css';

/** One side of a spread. `content` holds menu controls and renders below the title. */
export type BookPage = {
  kicker?: string;
  title?: ReactNode;
  text?: string;
  content?: ReactNode;
  /** Extra class for the page body, e.g. `book-page-dense` for form-heavy pages. */
  className?: string;
};

export type BookSpread = { left: BookPage; right: BookPage };

/** `cover` shows only the closed front cover; `closing` folds the book shut and then calls `onClosed`. */
export type BookPhase = 'cover' | 'open' | 'closing';

type Direction = 'next' | 'prev';
type ShownPhase = 'cover' | 'opening' | 'open' | 'closing';

/** Match the keyframes in BookMenu.css. */
const TURN_MS = 1500;
const OPEN_MS = 1400;
const FOLD_MS = 1300;
const SHRINK_MS = 600;

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Clicks on controls inside a page should use the control, not turn the page. */
function isInteractive(target: EventTarget | null) {
  return target instanceof Element && !!target.closest('button, a, input, select, textarea, label, form, [role="button"]');
}

const leftNumber = (spread: number) => spread * 2 + 1;
const rightNumber = (spread: number) => spread * 2 + 2;

function PageContent({ page, number }: { page: BookPage; number: number }) {
  return (
    <div className={`book-page-content ${page.className ?? ''}`}>
      {page.kicker && <span className="book-kicker">{page.kicker}</span>}
      {page.kicker && page.title && <div className="book-ornament" aria-hidden="true">◆</div>}
      {page.title && <h2>{page.title}</h2>}
      {page.text && <p>{page.text}</p>}
      {page.content && <div className="book-page-slot">{page.content}</div>}
      <span className="book-page-number">{number}</span>
    </div>
  );
}

/**
 * A two-page storybook that turns one leaf at a time. During a turn the page underneath
 * already shows the destination spread, while a 3D leaf flips over it: its front is the
 * page being lifted and its back is the page it lands as.
 *
 * Pass `spread` to drive it from app state; it then turns toward that spread on its own.
 * `phase` adds the closed front cover, which swings open onto the first spread and folds
 * back shut when the story leaves the book.
 */
export function BookMenu({
  spreads, spread: target, initialSpread = 0, onSpreadChange, label = 'Storybook menu', showNav = true,
  interactive = true, phase = 'open', cover, onClosed, className = '',
}: {
  spreads: BookSpread[];
  spread?: number;
  initialSpread?: number;
  onSpreadChange?: (spread: number) => void;
  label?: string;
  showNav?: boolean;
  /** When false, only `spread` turns pages: no clicks on pages or arrow keys. */
  interactive?: boolean;
  phase?: BookPhase;
  cover?: ReactNode;
  onClosed?: () => void;
  className?: string;
}) {
  const clamp = useCallback((index: number) => Math.min(Math.max(index, 0), spreads.length - 1), [spreads.length]);
  const [spread, setSpread] = useState(() => clamp(target ?? initialSpread));
  const [turning, setTurning] = useState<{ direction: Direction; to: number } | null>(null);
  const [shown, setShown] = useState<ShownPhase>(phase === 'cover' ? 'cover' : 'open');
  const shownRef = useRef(shown);
  const onClosedRef = useRef(onClosed);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => { shownRef.current = shown; }, [shown]);
  useEffect(() => { onClosedRef.current = onClosed; }, [onClosed]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const turnTo = useCallback((to: number) => {
    if (turning || to === spread || to < 0 || to >= spreads.length) return;
    const finish = () => {
      setSpread(to);
      setTurning(null);
      onSpreadChange?.(to);
    };
    if (prefersReducedMotion()) return finish();
    setTurning({ direction: to > spread ? 'next' : 'prev', to });
    timer.current = window.setTimeout(finish, TURN_MS);
  }, [turning, spread, spreads.length, onSpreadChange]);
  const turn = useCallback((direction: Direction) => turnTo(spread + (direction === 'next' ? 1 : -1)), [turnTo, spread]);

  // Controlled: follow `spread`, one turn at a time, so a jump that lands mid-turn still arrives.
  useEffect(() => {
    if (target === undefined) return;
    if (shown === 'open') turnTo(clamp(target));
    else if (shown === 'cover' && !turning) setSpread(clamp(target));
  }, [target, shown, turning, turnTo, clamp]);

  useEffect(() => {
    const from = shownRef.current;
    const animate = !prefersReducedMotion();
    let timeout: number | undefined;
    if (phase === 'cover') {
      setShown('cover');
    } else if (phase === 'open') {
      if (from === 'cover' && animate) {
        setShown('opening');
        timeout = window.setTimeout(() => setShown('open'), OPEN_MS);
      } else {
        setShown('open');
      }
    } else if (from === 'cover' || !animate) {
      onClosedRef.current?.();
    } else {
      setShown('closing');
      timeout = window.setTimeout(() => onClosedRef.current?.(), FOLD_MS + SHRINK_MS);
    }
    return () => window.clearTimeout(timeout);
  }, [phase]);

  useEffect(() => {
    if (!interactive || shown !== 'open') return;
    const onKeyDown = (event: KeyboardEvent) => {
      // Arrow keys belong to the caret while typing a name or room code.
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'ArrowRight') turn('next');
      if (event.key === 'ArrowLeft') turn('prev');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [turn, interactive, shown]);

  const onPageClick = (direction: Direction) => (event: MouseEvent) => {
    if (interactive && !isInteractive(event.target)) turn(direction);
  };

  const current = spreads[spread];
  if (!current) return null;
  const destination = turning ? spreads[turning.to] : undefined;
  const turningPrev = turning?.direction === 'prev' && destination;
  const turningNext = turning?.direction === 'next' && destination;
  const visibleLeft = turningPrev ? destination.left : current.left;
  const visibleRight = turningNext ? destination.right : current.right;
  const visibleLeftNumber = turningPrev ? leftNumber(turning.to) : leftNumber(spread);
  const visibleRightNumber = turningNext ? rightNumber(turning.to) : rightNumber(spread);
  const busy = !!turning || shown !== 'open';
  const staticBook = spreads.length === 1 || !interactive;

  return (
    <div
      className={`book-menu book-is-${shown} ${staticBook ? 'book-menu-static' : ''} ${className}`}
      style={{
        '--book-turn-ms': `${TURN_MS}ms`, '--book-open-ms': `${OPEN_MS}ms`,
        '--book-fold-ms': `${FOLD_MS}ms`, '--book-shrink-ms': `${SHRINK_MS}ms`,
      } as CSSProperties}
    >
      <section className="book-wrap" aria-label={label}>
        <div className="book">
          <div className="book-stack book-stack-left" aria-hidden="true" />
          <div className="book-stack book-stack-right" aria-hidden="true" />
          <div className="book-paper book-left" onClick={onPageClick('prev')} inert={busy}>
            <PageContent page={visibleLeft} number={visibleLeftNumber} />
          </div>
          <div className="book-paper book-right" onClick={onPageClick('next')} inert={busy}>
            <PageContent page={visibleRight} number={visibleRightNumber} />
          </div>

          {turning && destination && (
            <div className={`book-leaf ${turning.direction}`} aria-hidden="true" inert>
              <div className="book-face front">
                <PageContent
                  page={turning.direction === 'next' ? current.right : current.left}
                  number={turning.direction === 'next' ? rightNumber(spread) : leftNumber(spread)}
                />
              </div>
              <div className="book-face back">
                <PageContent
                  page={turning.direction === 'next' ? destination.left : destination.right}
                  number={turning.direction === 'next' ? leftNumber(turning.to) : rightNumber(turning.to)}
                />
              </div>
            </div>
          )}

          {shown !== 'open' && (
            <div className={`book-cover book-cover-${shown}`} inert={shown !== 'cover'}>
              <div className="book-cover-front">{cover}</div>
              {/* The inside of the cover: the first page of whatever spread the book opens to or shuts on. */}
              <div className="book-cover-back" aria-hidden="true" inert>
                <div className="book-paper book-left"><PageContent page={current.left} number={leftNumber(spread)} /></div>
              </div>
            </div>
          )}
          <div className="book-spine" aria-hidden="true" />
        </div>
      </section>

      {showNav && (
        <nav className="book-nav" aria-label="Book navigation">
          <button type="button" onClick={() => turn('prev')} disabled={spread === 0 || busy}>
            <span aria-hidden="true">←</span> Previous
          </button>
          <div className="book-progress" aria-label={`Spread ${spread + 1} of ${spreads.length}`}>
            {spreads.map((_, index) => <span key={index} className={index === spread ? 'active' : ''} />)}
          </div>
          <button type="button" onClick={() => turn('next')} disabled={spread === spreads.length - 1 || busy}>
            Next <span aria-hidden="true">→</span>
          </button>
        </nav>
      )}
    </div>
  );
}
