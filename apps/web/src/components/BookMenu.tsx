import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import './BookMenu.css';

/** One side of a spread. `content` holds menu controls and renders below the title. */
export type BookPage = {
  kicker?: string;
  title?: ReactNode;
  text?: string;
  content?: ReactNode;
};

export type BookSpread = { left: BookPage; right: BookPage };

type Direction = 'next' | 'prev';

/** Matches the turn keyframes in BookMenu.css. */
const TURN_MS = 1500;

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Clicks on controls inside a page should use the control, not turn the page. */
function isInteractive(target: EventTarget | null) {
  return target instanceof Element && !!target.closest('button, a, input, select, textarea, label, form, [role="button"]');
}

function PageContent({ page, number }: { page: BookPage; number: number }) {
  return (
    <div className="book-page-content">
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
 */
export function BookMenu({ spreads, initialSpread = 0, onSpreadChange, label = 'Storybook menu', showNav = true, className = '' }: {
  spreads: BookSpread[];
  initialSpread?: number;
  onSpreadChange?: (spread: number) => void;
  label?: string;
  showNav?: boolean;
  className?: string;
}) {
  const [spread, setSpread] = useState(() => Math.min(Math.max(initialSpread, 0), spreads.length - 1));
  const [turning, setTurning] = useState<Direction | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const turn = useCallback((direction: Direction) => {
    if (turning) return;
    const next = spread + (direction === 'next' ? 1 : -1);
    if (next < 0 || next >= spreads.length) return;
    const finish = () => {
      setSpread(next);
      setTurning(null);
      onSpreadChange?.(next);
    };
    if (prefersReducedMotion()) return finish();
    setTurning(direction);
    timer.current = window.setTimeout(finish, TURN_MS);
  }, [turning, spread, spreads.length, onSpreadChange]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Arrow keys belong to the caret while typing a name or room code.
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'ArrowRight') turn('next');
      if (event.key === 'ArrowLeft') turn('prev');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [turn]);

  const onPageClick = (direction: Direction) => (event: MouseEvent) => {
    if (!isInteractive(event.target)) turn(direction);
  };

  const current = spreads[spread];
  if (!current) return null;
  const nextSpread = turning === 'next' ? spreads[spread + 1] : undefined;
  const previousSpread = turning === 'prev' ? spreads[spread - 1] : undefined;
  const destination = turning === 'next' ? nextSpread?.left : previousSpread?.right;
  const visibleLeft = previousSpread?.left ?? current.left;
  const visibleRight = nextSpread?.right ?? current.right;
  const visibleLeftNumber = turning === 'prev' ? spread * 2 - 1 : spread * 2 + 1;
  const visibleRightNumber = turning === 'next' ? spread * 2 + 4 : spread * 2 + 2;

  return (
    <div className={`book-menu ${spreads.length === 1 ? 'book-menu-static' : ''} ${className}`} style={{ '--book-turn-ms': `${TURN_MS}ms` } as CSSProperties}>
      <section className="book-wrap" aria-label={label}>
        <div className="book">
          <div className="book-stack book-stack-left" aria-hidden="true" />
          <div className="book-stack book-stack-right" aria-hidden="true" />
          <div className="book-paper book-left" onClick={onPageClick('prev')} inert={!!turning}>
            <PageContent page={visibleLeft} number={visibleLeftNumber} />
          </div>
          <div className="book-paper book-right" onClick={onPageClick('next')} inert={!!turning}>
            <PageContent page={visibleRight} number={visibleRightNumber} />
          </div>

          {turning && destination && (
            <div className={`book-leaf ${turning}`} aria-hidden="true" inert>
              <div className="book-face front">
                <PageContent
                  page={turning === 'next' ? current.right : current.left}
                  number={turning === 'next' ? spread * 2 + 2 : spread * 2 + 1}
                />
              </div>
              <div className="book-face back">
                <PageContent page={destination} number={turning === 'next' ? spread * 2 + 3 : spread * 2} />
              </div>
            </div>
          )}
          <div className="book-spine" aria-hidden="true" />
        </div>
      </section>

      {showNav && (
        <nav className="book-nav" aria-label="Book navigation">
          <button type="button" onClick={() => turn('prev')} disabled={spread === 0 || !!turning}>
            <span aria-hidden="true">←</span> Previous
          </button>
          <div className="book-progress" aria-label={`Spread ${spread + 1} of ${spreads.length}`}>
            {spreads.map((_, index) => <span key={index} className={index === spread ? 'active' : ''} />)}
          </div>
          <button type="button" onClick={() => turn('next')} disabled={spread === spreads.length - 1 || !!turning}>
            Next <span aria-hidden="true">→</span>
          </button>
        </nav>
      )}
    </div>
  );
}
