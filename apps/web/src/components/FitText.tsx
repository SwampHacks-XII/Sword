import { useLayoutEffect, useRef, type ReactNode } from 'react';

// Shrink no further than this; past it, wrapping (balanced by CSS) reads better than tiny text.
const MIN_SCALE = 0.75;

/** Shrinks its text just enough to stay on one line; if that would make it too small, lets it wrap instead. */
export function FitText({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.fontSize = '';
      el.style.whiteSpace = 'nowrap';
      const available = el.clientWidth;
      const natural = el.scrollWidth;
      el.style.whiteSpace = '';
      if (!available || natural <= available) return;
      const scale = available / natural;
      if (scale >= MIN_SCALE) el.style.fontSize = `${parseFloat(getComputedStyle(el).fontSize) * scale * 0.98}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    void document.fonts?.ready.then(fit);
    return () => observer.disconnect();
  }, [children]);

  return <span ref={ref} className="fit-text">{children}</span>;
}
