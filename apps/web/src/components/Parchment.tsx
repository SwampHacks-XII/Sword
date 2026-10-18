import type { ReactNode } from 'react';
import { FitText } from './FitText';

/** Shared parchment surface for the storybook interface. */
export function Parchment({ title, className = '', children }: { title?: string; className?: string; children: ReactNode }) {
  return (
    <section className={`parchment ${className}`}>
      {title && <h2 className="parchment-title"><FitText>{title}</FitText></h2>}
      {children}
    </section>
  );
}
